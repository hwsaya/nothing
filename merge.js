const { name, type = "0", rules: rules_file } = $arguments;

// 1. 读取模板
let config = JSON.parse($files[0]);

// 2. 先追加自定义规则（如果传了 rules_file 且能成功读取）
if (rules_file) {
  try {
    let customRulesRaw = await produceArtifact({
      type: "file",
      name: rules_file,
    });
    if (customRulesRaw) {
      let customRules = JSON.parse(customRulesRaw);
      // 找到 clash_mode === "global" 规则索引（不判断 outbound）
      let idx = config.route.rules.findIndex(r => r.clash_mode === "global");
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

// 3. 拉取订阅或合集节点
let proxies = await produceArtifact({
  name,
  type: /^1$|col/i.test(type) ? "collection" : "subscription",
  platform: "sing-box",
  produceType: "internal",
});

// 4. 去重已有节点tag
const existingTags = config.outbounds.map(o => o.tag);
proxies = proxies.filter(p => !existingTags.includes(p.tag));

// 5. 添加新节点到 outbounds
config.outbounds.push(...proxies);

// 6. 准备节点基础数据
const allTags = proxies.map(p => p.tag);
const terminalTags = proxies.filter(p => !p.detour).map(p => p.tag);

// ========== 新增：地区分组核心配置 ==========
// 地区关键词映射（可按需扩展，支持多关键词匹配）
const regionMap = {
  HK: ["HK", "香港"],
  TW: ["TW", "台湾"],
  US: ["US", "美国"],
  JP: ["JP", "日本"],
  KR: ["KR", "韩国"],
  SG: ["SG", "新加坡"],
  DE: ["DE", "德国"],
  UK: ["UK", "英国"],
  AU: ["AU", "澳大利亚"]
};

// 预处理outbounds：区分「地区型」和「通用型」
const [regionOutbounds, generalOutbounds] = config.outbounds.reduce(([region, general], outbound) => {
  if (outbound.tag === "Direct-Out") return [region, general];
  // 判断是否为地区分类outbound（tag包含任一地区关键词）
  const isRegion = Object.values(regionMap).some(kwList => 
    kwList.some(kw => outbound.tag.includes(kw))
  );
  return isRegion ? [ [...region, outbound], general ] : [ region, [...general, outbound] ];
}, [[], []]);

// 辅助函数：获取节点所属地区（支持多地区匹配）
const getNodeRegions = (nodeTag) => 
  Object.keys(regionMap).filter(region => 
    regionMap[region].some(kw => nodeTag.includes(kw))
  );

// ========== 替换原逻辑：按地区插入节点 ==========
// 7. 地区型outbound：插入对应地区的节点
regionOutbounds.forEach(group => {
  if (!Array.isArray(group.outbounds)) return;
  // 找到当前outbound对应的所有地区
  const groupRegions = Object.keys(regionMap).filter(region => 
    regionMap[region].some(kw => group.tag.includes(kw))
  );
  // 筛选匹配当前地区的节点tag
  const matchedTags = proxies
    .filter(proxy => getNodeRegions(proxy.tag).some(r => groupRegions.includes(r)))
    .map(proxy => proxy.tag);
  // 遵循原逻辑：Relay组只插入无detour的节点
  const nodesToAdd = group.tag === "Relay" 
    ? matchedTags.filter(tag => terminalTags.includes(tag))
    : matchedTags;
  group.outbounds.push(...nodesToAdd);
});

// 8. 通用型outbound：插入未匹配到地区的节点
const unregionedTags = proxies
  .filter(proxy => getNodeRegions(proxy.tag).length === 0)
  .map(proxy => proxy.tag);

generalOutbounds.forEach(group => {
  if (!Array.isArray(group.outbounds)) return;
  const nodesToAdd = group.tag === "Relay" 
    ? unregionedTags.filter(tag => terminalTags.includes(tag))
    : unregionedTags;
  group.outbounds.push(...nodesToAdd);
});

// ========== 保留原逻辑：分组内去重 ==========
// 9. 分组内去重（避免重复插入）
config.outbounds.forEach(group => {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = [...new Set(group.outbounds)];
  }
});

// 10. 输出最终配置
$content = JSON.stringify(config, null, 2);
