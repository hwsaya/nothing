Const { name, type = "0", rules: rules_file } = $arguments;

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
    } else {
      // 文件没找到或为空，什么都不做，安静跳过
    }
  } catch (e) {
    // 解析或其它错误也不抛出，跳过规则插入
  }
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

// --- 核心修改开始 ---

// 6. 定义地区映射及节点分类
const regionMap = {
  // 键(Key)是内部标识符，值(Value)是用于匹配节点Tag的正则表达式列表
  'HK': [/HK/i, /香港/, /Hong Kong/i],
  'TW': [/TW/i, /台湾/, /Taiwan/i],
  'SG': [/SG/i, /新加坡/, /Singapore/i, /狮城/],
  'JP': [/JP/i, /日本/, /Japan/i],
  'US': [/US/i, /美国/, /United States/i],
  // ...您可以根据需要自行添加更多地区
};

/**
 * 辅助函数：根据 tag 和映射表获取地区标识符 (Key)
 * @param {string} tag - 节点或分组的 Tag
 * @param {Object} map - 地区映射表
 * @returns {string} - 地区标识符 (如 'HK', 'TW') 或 'other'
 */
function getRegionKey(tag, map) {
  for (const [key, patterns] of Object.entries(map)) {
    if (patterns.some(regex => regex.test(tag))) {
      return key; // 返回 'HK', 'TW' 等
    }
  }
  return 'other'; // 未匹配任何地区
}

// 存储分类后的节点
const categorizedTags = {}; // 存储所有新节点
const categorizedTerminalTags = {}; // 仅存储新节点中的末端节点 (非 detour)
const allRegionKeys = ['other', ...Object.keys(regionMap)];

// 初始化分类对象
allRegionKeys.forEach(key => {
  categorizedTags[key] = [];
  categorizedTerminalTags[key] = [];
});

// 遍历新拉取的节点 (proxies) 进行分类
proxies.forEach(proxy => {
  const regionKey = getRegionKey(proxy.tag, regionMap);
  
  // 添加到全集
  categorizedTags[regionKey].push(proxy.tag);
  
  if (!proxy.detour) { // 如果是末端节点
    // 添加到末端节点集
    categorizedTerminalTags[regionKey].push(proxy.tag);
  }
});

// 7. 遍历分组，按地区追加节点
config.outbounds.forEach(group => {
  // 如果 group.outbounds 不是数组 (说明它不是一个分组)，或者 tag 是 "Direct-Out"，则跳过
  if (!Array.isArray(group.outbounds) || group.tag === "Direct-Out") {
    return;
  }

  // 检查当前分组是否为 "Relay"
  const isRelayGroup = group.tag === "Relay";
  
  // 根据分组是否为 "Relay" 来决定使用哪个节点源
  // Relay 分组只应包含末端节点
  const sourceTags = isRelayGroup ? categorizedTerminalTags : categorizedTags;

  // 判断当前分组(group)的 tag 属于哪个地区
  const groupRegionKey = getRegionKey(group.tag, regionMap);

  if (groupRegionKey !== 'other') {
    // === 1. 地区分组 (如 "HK", "香港", "JP" ...) ===
    // 只添加对应地区的节点
    // (例如 "HK" 分组只添加 categorizedTags['HK'] 或 categorizedTerminalTags['HK'])
    group.outbounds.push(...sourceTags[groupRegionKey]);
    
    // [可选] 如果您希望地区分组也包含 "other" 里的节点作为备用，可以解除下面这行注释
    // group.outbounds.push(...sourceTags['other']); 

  } else {
    // === 2. 其他分组 (如 "Auto", "Select", "Failover", 或 "Relay") ===
    // "Relay" 分组也会进入这里 (因为 isRelayGroup=true, groupRegionKey='other')
    // 这些分组需要添加所有地区的节点
    allRegionKeys.forEach(key => {
      group.outbounds.push(...sourceTags[key]);
    });
  }
});

// --- 核心修改结束 ---

// 8. 分组内去重 (此步骤保持不变，但至关重要)
config.outbounds.forEach(group => {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = [...new Set(group.outbounds)];
  }
});

// 9. 输出最终配置
$content = JSON.stringify(config, null, 2);