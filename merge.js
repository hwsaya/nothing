Const { name, type = "0", rules: rules_file } = $arguments;
​// 1. 读取模板
let config = JSON.parse($files[0]);
​// 2. 先追加自定义规则（如果传了 rules_file 且能成功读取）
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
​// 3. 拉取订阅或合集节点
let proxies = await produceArtifact({
name,
type: /^1$|col/i.test(type) ? "collection" : "subscription",
platform: "sing-box",
produceType: "internal",
});
​// 4. 去重已有节点tag
const existingTags = config.outbounds.map(o => o.tag);
proxies = proxies.filter(p => !existingTags.includes(p.tag));
​// 5. 添加新节点到 outbounds
config.outbounds.push(...proxies);
​// 6. 准备 regional-aware tag 列表 (替换原 step 6)
​// 6.1. 定义地区关键词
// 您可以根据需要修改或扩充这个列表
const regionMap = {
'HK': ['HK', '香港', 'Hong Kong', 'HONGKONG'],
'TW': ['TW', '台湾', 'Taiwan', 'TAIWAN'],
'SG': ['SG', '新加坡', 'Singapore', 'SINGAPORE'],
'JP': ['JP', '日本', 'Japan', 'JAPAN'],
'US': ['US', '美国', 'United States', 'USA'],
'KR': ['KR', '韩国', 'Korea', 'KOREA'],
'DE': ['DE', '德国', 'Germany', 'GERMANY'],
'GB': ['GB', '英国', 'United Kingdom', 'UK'],
// 在这里添加更多地区...
};
​// 6.2. 辅助函数：根据 tag 获取地区
function getTagRegion(tag, map) {
if (!tag) return null;
const lowerTag = tag.toLowerCase();
for (const [region, keywords] of Object.entries(map)) {
for (const keyword of keywords) {
if (lowerTag.includes(keyword.toLowerCase())) {
return region; // 匹配到地区
}
}
}
return null; // 未匹配到地区
}
​// 6.3. 分类所有新节点
const proxiesByRegion = {};         // 按地区分的 {HK: [...], SG: [...]}
const terminalProxiesByRegion = {}; // 按地区分的 (terminal only) {HK: [...], SG: [...]}
const otherProxies = [];            // 未匹配到地区的节点
const otherTerminalProxies = [];    // 未匹配到地区的 (terminal only)
​proxies.forEach(p => {
const region = getTagRegion(p.tag, regionMap);
const tag = p.tag;
const isTerminal = !p.detour; // 'detour' 字段不存在或为 false/null/undefined
​if (region) {
// 归类到特定地区
if (!proxiesByRegion[region]) proxiesByRegion[region] = [];
proxiesByRegion[region].push(tag);} else {
// 归类到 "Other" (其他)
otherProxies.push(tag);
if (isTerminal) {
otherTerminalProxies.push(tag);
}
}
});
​// 7. 遍历分组追加节点 (替换原 step 7)
config.outbounds.forEach(group => {
// 必须是数组类型的 outbounds，且不能是 'Direct-Out'
if (!Array.isArray(group.outbounds) || group.tag === "Direct-Out") return;
​const groupRegion = getTagRegion(group.tag, regionMap);
const lowerGroupTag = group.tag.toLowerCase();
​if (groupRegion) {
// 这是一个地区分组 (例如 "HK", "香港", "HK-Select")} else {
// 这是一个 "其他" 分组 (非地区分组, 例如 "Auto", "Select", "Fallback", "Relay")}
});
​// 8. 分组内去重 (保持不变)
config.outbounds.forEach(group => {
if (Array.isArray(group.outbounds)) {
group.outbounds = [...new Set(group.outbounds)];
}
});
​// 9. 输出最终配置 (保持不变)
$content = JSON.stringify(config, null, 2);