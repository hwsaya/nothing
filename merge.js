const { name, type = "0", rules: rules_file } = $arguments;

// 1. 读取模板
let config = JSON.parse($files[0]);

// 2. 追加自定义规则（传了rules_file且能读取时执行）
if (rules_file) {
  try {
    let customRulesRaw = await produceArtifact({
      type: "file",
      name: rules_file,
    });
    if (customRulesRaw) {
      let customRules = JSON.parse(customRulesRaw);
      const idx = config.route.rules.findIndex(r => r.clash_mode === "global");
      if (idx !== -1) {
        const existingRulesStr = new Set(config.route.rules.map(r => JSON.stringify(r)));
        customRules = customRules.filter(r => !existingRulesStr.has(JSON.stringify(r)));
        config.route.rules.splice(idx + 1, 0, ...customRules);
      } else {
        config.route.rules.push(...customRules);
      }
    }
  } catch (e) { /* 静默处理错误 */ }
}

// 3. 拉取订阅/合集节点
let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? "collection" : "subscription",
  platform: "sing-box",
  produceType: "internal",
});

// 4. 去重已有节点tag
const existingTags = config.outbounds.map(o => o.tag);
proxies = proxies.filter(p => !existingTags.includes(p.tag));

// 5. 将新节点添加到outbounds列表
config.outbounds.push(...proxies);

// ========== 地区分组核心逻辑 ==========
// 地区关键词配置（可按需扩展）
const regionKeywords = {
  香港: ["HK", "香港"],
  台湾: ["TW", "台湾", "台"],
  美国: ["US", "美国", "美"],
  日本: ["JP", "日本", "日"],
  韩国: ["KR", "韩国", "韩"],
  新加坡: ["SG", "新加坡"],
  英国: ["UK", "英国", "英"],
  德国: ["DE", "德国", "德"],
  澳大利亚: ["AU", "澳大利亚", "澳"],
  加拿大: ["CA", "加拿大", "加"]
};

// 筛选出所有「地区分类outbound」（排除Direct-Out）
const regionOutboundTags = new Set();
config.outbounds.forEach(outbound => {
  if (outbound.tag === "Direct-Out") return;
  Object.values(regionKeywords).forEach(kwList => {
    if (kwList.some(kw => outbound.tag.includes(kw))) {
      regionOutboundTags.add(outbound.tag);
    }
  });
});

// 辅助函数：根据节点tag获取匹配的地区
const getMatchedRegions = (nodeTag) => {
  return Object.keys(regionKeywords).filter(region => 
    regionKeywords[region].some(kw => nodeTag.includes(kw))
  );
};

// 辅助函数：根据地区获取对应的outbound列表
const getOutboundsByRegion = (region) => {
  const kws = regionKeywords[region];
  return config.outbounds.filter(outbound => 
    !Array.isArray(outbound.outbounds) ? false : kws.some(kw => outbound.tag.includes(kw))
  );
};

// 按地区匹配插入节点
proxies.forEach(proxy => {
  const matchedRegions = getMatchedRegions(proxy.tag);
  const isTerminal = !proxy.detour; // 是否为无detour的终端节点

  if (matchedRegions.length > 0) {
    // 匹配到地区：插入对应地区的所有outbound
    matchedRegions.forEach(region => {
      const targetOutbounds = getOutboundsByRegion(region);
      targetOutbounds.forEach(outbound => {
        if (outbound.tag === "Relay" && !isTerminal) return; // Relay组仅插入终端节点
        outbound.outbounds.push(proxy.tag);
      });
    });
  } else {
    // 未匹配到地区：插入非地区分类的outbound
    config.outbounds.forEach(outbound => {
      if (outbound.tag === "Direct-Out" || regionOutboundTags.has(outbound.tag)) return;
      if (!Array.isArray(outbound.outbounds)) return;
      
      if (outbound.tag === "Relay" && !isTerminal) return;
      outbound.outbounds.push(proxy.tag);
    });
  }
});

// ========== 分组内去重 ==========
config.outbounds.forEach(group => {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = [...new Set(group.outbounds)];
  }
});

// 6. 输出最终配置
$content = JSON.stringify(config, null, 2);
