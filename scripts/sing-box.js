// ============================================================
// ✏️ 在这里编辑参数 — 本地使用时直接改；远程拉取时由 URL 参数覆盖
// ============================================================

const DEFAULTS = {
  // 订阅类型: '组合' 或 'subscription'（单订阅）
  type: '组合',

  // Sub Store 中配置的订阅名称
  name: 'All',

  // 是否包含 SSR 等不受官方支持的协议
  includeUnsupportedProxy: false,

  // 直接从 URL 读取订阅（可选）
  url: '',

  // ── outbound 规则 ──────────────────────────────────────────
  // tags      : sing-box 配置中的 outbound tag（支持正则）
  // include   : 节点名称匹配关键词（支持正则，留空 = 全部节点）
  // protocol  : 按协议筛选（可选：vless / hysteria2 / trojan 等）
  // ignoreCase: 忽略大小写，默认 true
  // ──────────────────────────────────────────────────────────
  outboundRules: [
    {
      tags: 'Auto',
    },
    {
      tags: 'HK',
      include: '港|hk|hongkong|kong kong|🇭🇰',
    },
    {
      tags: 'TW',
      include: '台|tw|taiwan|🇹🇼',
    },
    {
      tags: 'JP',
      include: '日本|jp|japan|🇯🇵',
    },
    {
      tags: 'KR',
      include: '韩国|kr|south korea|🇰🇷',
    },
    {
      tags: 'SG',
      include: '^(?!.*(?:us)).*(新|sg|singapore|🇸🇬)',
    },
    {
      tags: 'US',
      include: '美|us|unitedstates|united states|🇺🇸',
    },
    {
      tags: '广东',
      include: '广州',
    },
    {
      tags: 'vless',
      protocol: 'vless',
    },
    {
      tags: 'hysteria2',
      protocol: 'hysteria2',
    },
  ],
}

// ============================================================
// ⚠️ 以下为脚本正文，一般无需修改
// ============================================================

log(`🚀 开始`)

const args = (typeof $arguments !== 'undefined' && $arguments && Object.keys($arguments).length)
  ? $arguments : {}

let type                    = args.type                    ?? DEFAULTS.type
let name                    = args.name                    ?? DEFAULTS.name
let includeUnsupportedProxy = args.includeUnsupportedProxy ?? DEFAULTS.includeUnsupportedProxy
let url                     = args.url                     ?? DEFAULTS.url
let outbound                = args.outbound                ?? buildOutboundString(DEFAULTS.outboundRules)

log(`传入参数 type: ${type}, name: ${name}`)
log(`生成的 outbound 字符串: ${outbound}`)

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'
log(`订阅类型解析结果: ${type}`)

const parser = ProxyUtils.JSON5 || JSON
log(`① 使用 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 解析配置文件`)
let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}
log(`配置文件解析成功，outbounds 数量: ${config.outbounds?.length ?? 0}`)
log(`配置文件中的 outbound tags: ${config.outbounds?.map(o => o.tag).join(', ')}`)

log(`② 获取订阅`)
let proxies
try {
  if (url) {
    log(`直接从 URL ${url} 读取订阅`)
    proxies = await produceArtifact({
      name, type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
      subscription: { name, url, source: 'remote' },
    })
  } else {
    log(`将读取名称为 "${name}" 的 ${type === 'collection' ? '组合' : '单'}订阅`)
    proxies = await produceArtifact({
      name, type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
    })
  }
} catch (e) {
  throw new Error(`获取订阅失败: ${e.message ?? e}，请检查订阅名称 "${name}" 是否正确`)
}

if (!proxies || proxies.length === 0) {
  throw new Error(`订阅 "${name}" 未返回任何节点，请检查：① 订阅名称是否与 Sub Store 中一致 ② 订阅类型 type 是否正确（组合/subscription）③ 订阅是否有效`)
}

log(`获取到 ${proxies.length} 个节点`)
log(`前5个节点: ${proxies.slice(0, 5).map(p => `${p.tag}(${p.type})`).join(', ')}`)

log(`③ outbound 规则解析`)
const outbounds = outbound
  .split('🕳')
  .filter(i => i)
  .map(i => {
    let [outboundPattern, rest = ''] = i.split('🏷')
    let tagPattern = '.*'
    let protocolPattern = null

    if (rest.includes('🔧')) {
      const parts = rest.split('🔧')
      tagPattern = parts[0] || '.*'
      protocolPattern = parts[1] ? parts[1].trim() : null
    } else {
      tagPattern = rest || '.*'
    }

    const tagRegex = createTagRegExp(tagPattern)
    const protocolRegex = protocolPattern ? createProtocolRegExp(protocolPattern) : null

    if (protocolRegex) {
      log(`规则: outbound匹配 ${createOutboundRegExp(outboundPattern)} | 节点匹配 ${tagRegex} | 协议 ${protocolRegex}`)
    } else {
      log(`规则: outbound匹配 ${createOutboundRegExp(outboundPattern)} | 节点匹配 ${tagRegex}`)
    }

    return [outboundPattern, tagRegex, protocolRegex]
  })

log(`④ outbound 插入节点`)
config.outbounds.map(outbound => {
  outbounds.map(([outboundPattern, tagRegex, protocolRegex]) => {
    const outboundRegex = createOutboundRegExp(outboundPattern)
    if (outboundRegex.test(outbound.tag)) {
      if (!Array.isArray(outbound.outbounds)) outbound.outbounds = []
      const tags = getTags(proxies, tagRegex, protocolRegex)
      const protocolInfo = protocolRegex ? ` 协议:${protocolRegex}` : ''
      log(`✅ "${outbound.tag}" 匹配规则 ${outboundRegex}，插入 ${tags.length} 个节点 (筛选:${tagRegex}${protocolInfo})`)
      outbound.outbounds.push(...tags)
    }
  })
})

const compatible_outbound = { tag: 'COMPATIBLE', type: 'direct' }
let compatible

log(`⑤ 空 outbounds 检查`)
config.outbounds.map(outbound => {
  outbounds.map(([outboundPattern, tagRegex, protocolRegex]) => {
    const outboundRegex = createOutboundRegExp(outboundPattern)
    if (outboundRegex.test(outbound.tag)) {
      if (!Array.isArray(outbound.outbounds)) outbound.outbounds = []
      if (outbound.outbounds.length === 0) {
        if (!compatible) {
          config.outbounds.push(compatible_outbound)
          compatible = true
        }
        log(`⚠️ "${outbound.tag}" 的 outbounds 为空，自动插入 COMPATIBLE(direct)`)
        outbound.outbounds.push(compatible_outbound.tag)
      }
    }
  })
})

config.outbounds.push(...proxies)
$content = JSON.stringify(config, null, 2)

// ---- 工具函数 ----

function buildOutboundString(rules) {
  return rules.map(r => {
    const ic = r.ignoreCase === false ? '' : 'ℹ️'
    const outPart = `${ic}${r.tags}`

    if (!r.include && !r.protocol) return outPart
    if (r.protocol && !r.include)  return `${outPart}🏷🔧${r.protocol}`
    if (r.protocol && r.include)   return `${outPart}🏷${ic}${r.include}🔧${r.protocol}`
    return `${outPart}🏷${ic}${r.include}`
  }).join('🕳')
}

function getTags(proxies, tagRegex, protocolRegex) {
  let filtered = proxies
  if (tagRegex)      filtered = filtered.filter(p => tagRegex.test(p.tag))
  if (protocolRegex) filtered = filtered.filter(p => p.type && protocolRegex.test(p.type))
  return filtered.map(p => p.tag)
}

function log(v) {
  console.log(`[📦 sing-box] ${v}`)
}

function createTagRegExp(tagPattern) {
  return new RegExp(tagPattern.replace('ℹ️', ''), tagPattern.includes('ℹ️') ? 'i' : undefined)
}

function createOutboundRegExp(outboundPattern) {
  return new RegExp(outboundPattern.replace('ℹ️', ''), outboundPattern.includes('ℹ️') ? 'i' : undefined)
}

function createProtocolRegExp(protocolPattern) {
  return new RegExp(protocolPattern.replace('ℹ️', ''), protocolPattern.includes('ℹ️') ? 'i' : undefined)
}

log(`🔚 结束`)
 