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

// ========== 新增：地区分组核心逻辑 ==========
// 地区关键词配置（可按需扩展，key为地区标识，value为匹配关键词数组）
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

// 步骤1：筛选出所有「地区分类outbound」（tag含任一地区关键词）
const regionOutboundTags = new Set();
config.outbounds.forEach(outbound => {
  if (outbound.tag === "Direct-Out") return;
  Object.values(regionKeywords).forEach(kwList => {
    if (kwList.some(kw => outbound.tag.includes(kw))) {
      regionOutboundTags.add(outbound.tag);
    }
  });
});

// 步骤2：辅助函数 - 根据节点tag获取匹配的地区
const getMatchedRegions = (nodeTag) => {
  return Object.keys(regionKeywords).filter(region => 
    regionKeywords[region].some(kw => nodeTag.includes(kw))
  );
};

// 步骤3：辅助函数 - 根据地区获取对应的outbound列表
const getOutboundsByRegion = (region) => {
  const kws = regionKeywords[region];
  return config.outbounds.filter(outbound => 
    !Array.isArray(outbound.outbounds) ? false : kws.some(kw => outbound.tag.includes(kw))
  );
};

// 步骤4：按地区匹配插入节点
proxies.forEach(proxy => {
  const matchedRegions = getMatchedRegions(proxy.tag);
  const isTerminal = !proxy.detour; // 是否为终端节点（无detour）

  if (matchedRegions.length > 0) {
    // 有匹配地区：插入所有对应地区的outbound
    matchedRegions.forEach(region => {
      const targetOutbounds = getOutboundsByRegion(region);
      targetOutbounds.forEach(outbound => {
        if (outbound.tag === "Relay" && !isTerminal) return; // Relay组只加终端节点
        outbound.outbounds.push(proxy.tag);
      });
    });
  } else {
    // 无匹配地区：插入非地区分类的outbound（排除Direct-Out）
    config.outbounds.forEach(outbound => {
      if (outbound.tag === "Direct-Out" || regionOutboundTags.has(outbound.tag)) return;
      if (!Array.isArray(outbound.outbounds)) return;
      
      if (outbound.tag === "Relay" && !isTerminal) return;
      outbound.outbounds.push(proxy.tag);
    });
  }
});

// ========== 保留原逻辑：分组内去重 ==========
config.outbounds.forEach(group => {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = [...new Set(group.outbounds)];
  }
});

// 6. 输出最终配置
$content = JSON.stringify(config, null, 2);
