// 替换ES6解构赋值（ES5不支持）
var name = $arguments.name;
var type = $arguments.type || "0";
var rules_file = $arguments.rules;

// 1. 读取模板
var config = JSON.parse($files[0]);

// 2. 追加自定义规则（传了rules_file且能读取时执行）
if (rules_file) {
  try {
    var customRulesRaw = await produceArtifact({
      type: "file",
      name: rules_file
    });
    if (customRulesRaw) {
      var customRules = JSON.parse(customRulesRaw);
      var idx = config.route.rules.findIndex(function(r) {
        return r.clash_mode === "global";
      });
      if (idx !== -1) {
        var existingRulesStr = new Set(config.route.rules.map(function(r) {
          return JSON.stringify(r);
        }));
        customRules = customRules.filter(function(r) {
          return !existingRulesStr.has(JSON.stringify(r));
        });
        config.route.rules.splice(idx + 1, 0, ...customRules);
      } else {
        config.route.rules.push(...customRules);
      }
    }
  } catch (e) { /* 静默处理错误 */ }
}

// 3. 拉取订阅/合集节点
var proxies = await produceArtifact({
  name: name,
  type: /^1$|col/i.test(type) ? "collection" : "subscription",
  platform: "sing-box",
  produceType: "internal"
});

// 4. 去重已有节点tag
var existingTags = config.outbounds.map(function(o) {
  return o.tag;
});
proxies = proxies.filter(function(p) {
  return existingTags.indexOf(p.tag) === -1;
});

// 5. 将新节点添加到outbounds列表
config.outbounds.push(...proxies);

// ========== 地区分组核心逻辑（ES5版本） ==========
// 地区关键词配置（可按需扩展）
var regionKeywords = {
  "香港": ["HK", "香港"],
  "台湾": ["TW", "台湾", "台"],
  "美国": ["US", "美国", "美"],
  "日本": ["JP", "日本", "日"],
  "韩国": ["KR", "韩国", "韩"],
  "新加坡": ["SG", "新加坡"],
  "英国": ["UK", "英国", "英"],
  "德国": ["DE", "德国", "德"],
  "澳大利亚": ["AU", "澳大利亚", "澳"],
  "加拿大": ["CA", "加拿大", "加"]
};

// 筛选出所有「地区分类outbound」（排除Direct-Out）
var regionOutboundTags = new Set();
config.outbounds.forEach(function(outbound) {
  if (outbound.tag === "Direct-Out") return;
  Object.values(regionKeywords).forEach(function(kwList) {
    if (kwList.some(function(kw) {
      return outbound.tag.includes(kw);
    })) {
      regionOutboundTags.add(outbound.tag);
    }
  });
});

// 辅助函数：根据节点tag获取匹配的地区
function getMatchedRegions(nodeTag) {
  return Object.keys(regionKeywords).filter(function(region) {
    return regionKeywords[region].some(function(kw) {
      return nodeTag.includes(kw);
    });
  });
}

// 辅助函数：根据地区获取对应的outbound列表
function getOutboundsByRegion(region) {
  var kws = regionKeywords[region];
  return config.outbounds.filter(function(outbound) {
    if (!Array.isArray(outbound.outbounds)) return false;
    return kws.some(function(kw) {
      return outbound.tag.includes(kw);
    });
  });
}

// 按地区匹配插入节点
proxies.forEach(function(proxy) {
  var matchedRegions = getMatchedRegions(proxy.tag);
  var isTerminal = !proxy.detour; // 是否为无detour的终端节点

  if (matchedRegions.length > 0) {
    // 匹配到地区：插入对应地区的所有outbound
    matchedRegions.forEach(function(region) {
      var targetOutbounds = getOutboundsByRegion(region);
      targetOutbounds.forEach(function(outbound) {
        if (outbound.tag === "Relay" && !isTerminal) return; // Relay组仅插入终端节点
        outbound.outbounds.push(proxy.tag);
      });
    });
  } else {
    // 未匹配到地区：插入非地区分类的outbound
    config.outbounds.forEach(function(outbound) {
      if (outbound.tag === "Direct-Out" || regionOutboundTags.has(outbound.tag)) return;
      if (!Array.isArray(outbound.outbounds)) return;
      
      if (outbound.tag === "Relay" && !isTerminal) return;
      outbound.outbounds.push(proxy.tag);
    });
  }
});

// ========== 分组内去重 ==========
config.outbounds.forEach(function(group) {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = Array.from(new Set(group.outbounds));
  }
});

// 6. 输出最终配置
$content = JSON.stringify(config, null, 2);
