# Job Hunter（Boss 直聘岗位聚合，个人求职用）

只采集、不自动投递。把 Boss 直聘的岗位汇总成一份当天列表，按「简历匹配度 → 通勤时间 → 公司质量」排序，并且每天与历史不重复。所有筛选条件都可在 `config/config.json` 里自定义。

## 特性

- 本地 HTTP 服务器 + 书签注入脚本，在页面原生 JS 上下文里采集，避开 Playwright/CDP 检测导致的整页刷新。
- 按你的画像自动匹配打分：`resume_keywords`（核心技能权重高、附加技能仅加分）。
- 通勤估算：用 `home` 坐标 + 岗位坐标估算时间，支持接入高德 API 算真实通勤。
- 公司质量：工商信息 + LLM 风评 + 员工口碑，综合打分。
- 自动过滤：底薪下限、区域白名单、黑名单。
- 跨天去重：展示过的「公司|岗位」记入 `data/history.json`，不会重复展示。

## 快速开始

```bash
# 1. 生成你的配置（config.json 为私有配置，不会被提交）
cp config/config.example.json config/config.json

# 2.（可选）仅旧 Playwright 版需要依赖；书签方案无需 npm install
npm install

# 3. 启动采集服务器
node scripts/collect-server.js
```

1. 编辑 `config/config.json` 填入你的城市、坐标、区域、关键词（见下文「自定义筛选」）。
2. 浏览器打开 `http://127.0.0.1:8890`，把「采集岗位」按钮拖到书签栏。
3. 打开 Boss 直聘搜索页并设好筛选条件，点书签栏的「采集岗位」。
4. 在页面点选某个岗位，再点面板里的「从选中岗位开始采集」，脚本会从该岗位往下采。
5. 采集完成后，报告在 `data/report.html`，也可在线看 `http://127.0.0.1:8890/report`。

> 安全认证刷新页面后：重新点一次书签即可，采集进度存在浏览器 localStorage，会自动续上。

## 自定义筛选（config/config.json）

| 字段 | 说明 |
| --- | --- |
| `city` / `city_code` | 城市名与 Boss 城市编码。城市编码见 Boss 搜索页 URL 里的 `city=`（如深圳 `101280600`）。 |
| `home.name` / `home.lat` / `home.lng` | 你的居住地名称与经纬度，用于估算通勤。 |
| `districts` | 只看这些区，数组，如 `["南山区","福田区"]`；留空则不按区过滤。 |
| `commute.near_minutes` | 小于该分钟数标记为「高优先」。 |
| `commute.prefer_max_minutes` | 小于该分钟数标记为「中优先」，超过为「低优先」。 |
| `salary.min_base_k` | 底薪下限（单位 K），薪资区间下限低于该值的岗位自动过滤。 |
| `search_keywords` | 在 Boss 搜索的关键词列表。 |
| `resume_keywords.primary` | 简历核心技能，匹配权重最高。 |
| `resume_keywords.secondary` | 简历附加技能，仅加分。 |
| `company_filter` | 备用公司筛选：成立年限、注册资本下限。 |
| `llm.base_url` / `llm.model` | 公司风评用的 OpenAI 兼容接口地址与模型名；也可用环境变量 `JOBHUNTER_LLM_BASE` / `JOBHUNTER_LLM_MODEL` 覆盖。 |
| `map_api.key` | 可选，高德地图 key，填了就用真实公交通勤，否则用本地估算。 |
| `collect_server.target_per_day` | 每天展示上限，且与历史不重复。 |
| `collect_server.max_cards_per_run` | 单次采集上限，多出的进 pending 留到次日。 |

### 区域坐标表

通勤估算用的区域坐标表放在私有文件 `data/geo-areas.json`（不进版本库），格式：

```json
{
  "AREAS": { "科技园": { "district": "南山区", "lat": 22.541, "lng": 113.944 } },
  "DISTRICT_DEFAULT": { "南山区": { "lat": 22.541, "lng": 113.944 } },
  "ALL_DISTRICTS": ["南山区", "福田区"]
}
```

- `AREAS`：商圈/地点名 → 坐标。
- `DISTRICT_DEFAULT`：区名 → 默认坐标。
- `ALL_DISTRICTS`：区名列表。

### 黑名单

- 报告里每行有「拉黑」按钮，点一下立即生效并刷新。
- 打开 `http://127.0.0.1:8890/blacklist` 管理黑名单；岗位名留空则拉黑整家公司。
- 黑名单持久化在 `data/blacklist.json`，每次汇总自动剔除。

### 员工口碑库

`data/employee-reviews.json` 是私有口碑库（不进版本库），格式：

```json
[
  {
    "aliases": ["公司别名1", "公司别名2"],
    "items": [
      { "sentiment": "正面", "source": "来源", "text": "一句话评价" }
    ]
  }
]
```

`sentiment` 可选：`正面 / 负面 / 中性 / 两极`。

## 目录结构

```text
config/
  config.example.json            配置模板（公开）
  config.json                    你的私有配置（不提交）
scripts/
  collect-server.js              本地采集服务器（端口 8890）
  run-daily.js                   旧 Playwright 版一键跑批（其他站点参考）
  parse-companies.js             解析公司工商信息
  run-company-audit.js           手动补跑公司风评
  run-employee-reviews.js        手动补跑员工口碑
lib/
  inject/collect-bookmarklet.js  注入页面的采集脚本（只读，不投递）
  aggregate.js                   汇总、排序、过滤、生成报告
  history.js                     跨天去重
  resume-match.js                简历关键词匹配打分
  commute.js                     通勤估算
  geo-areas.js                   区域坐标加载器（读 data/geo-areas.json）
  company-filter.js              公司基础筛选
  company-audit.js               LLM 公司风评
  employee-reviews.js            员工口碑加载器
  blacklist.js                   黑名单
  sources/boss.js                旧 Playwright 版（不推荐在 Boss 用）
data/                            输出目录（report.html、history.json、blacklist.json 等，全部私有）
```

## 隐私与安全

- `data/` 和 `config/config.json` 都是私有内容，`.gitignore` 已忽略，上传 GitHub 前请再次确认不包含个人数据。
- 只采集、不自动投递；请使用你自己的账号与登录态。
- 控制采集频率，遵守平台用户协议，合法使用数据。
- 不绕过验证码、不破解登录墙。出现安全认证时请手动完成。

## 免责声明

本项目仅供个人求职整理使用，不对采集数据的准确性、完整性负责。请遵守相关平台条款与当地法律法规。