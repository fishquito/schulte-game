# 排行榜后端（Node.js，零依赖）

专注力训练馆的后端：档案、成绩、排行榜，外加把静态站点一起托管。

**一个进程，每个游戏一个模块、一个数据文件。** 公共部分只留「档案」和「静态托管」——
因为档案号是四个游戏通用的钥匙；其余（榜单、校验、排序、存储）全在各游戏自己的目录里。

## 目录结构

```
server.js              入口：起服务、静态托管、身份接口、按 /api/<game>/... 分发
lib/
  store.js             一个 JSON 文件一个小库（原子写入）
  http.js              响应 / CORS / 读 body / 限流
  players.js           档案（昵称 + 9 位档案号）—— 四个游戏共用
  migrate.js           把旧版单文件 scores.json 拆成每游戏一个文件
games/
  index.js             注册表：扫 games 下每个子目录，谁在谁上线
  schulte/index.js     舒尔特方格：榜单维度、校验、排序
  stroop/index.js      色字冲突
  nback/index.js       N-back
  memory/index.js      记忆矩阵
data/                  运行时生成（已 gitignore）
  players.json         所有档案
  schulte.json         只放舒尔特的成绩
  stroop.json
  nback.json
  memory.json
```

删掉 `games/xxx/` 一个目录，这个游戏就下线了，`server.js` 一行都不用改。

## 运行

```bash
cd server
node server.js
```

默认监听 `127.0.0.1:8090`，同时把**上级目录**当作静态站点托管——直接打开
`http://127.0.0.1:8090/` 就是大厅，前后端同源，不需要任何配置。

静态服务支持目录索引：`/schulte/` 和 `/schulte` 都会返回 `schulte/index.html`。

> 绑定 `127.0.0.1` 是给「前面有 nginx / Caddy 反代」的场景用的；如果想让局域网直接访问，
> 用 `HOST=0.0.0.0 node server.js`。

```bash
PORT=9000 node server.js                                  # 换端口
ALLOW_ORIGIN=https://fishquito.site node server.js        # 限制跨域来源
HOST=0.0.0.0 node server.js                               # 允许局域网直连
DATA_DIR=/var/lib/focus node server.js                    # 换数据目录
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8090` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（反代场景只开回环） |
| `DATA_DIR` | `server/data` | 数据目录，每个游戏一个 json |
| `DATA_FILE` | `server/data/scores.json` | 旧版单文件路径；只用来推导 `DATA_DIR` 和做一次性迁移 |
| `STATIC_DIR` | 仓库根目录 | 静态站点根目录 |
| `ALLOW_ORIGIN` | `*` | CORS 允许的来源，建议上线后改成你的站点域名 |

## 接口

```
POST  /api/register        {name}                 → {id, name}        建档案，返回 9 位档案号
POST  /api/login           {id}                   → {id, name} | 404  用档案号换回档案
PATCH /api/player          {id, name}             → {id, name}        改昵称

GET   /api/games                                  → {games:[{id,label,desc,variants,rows}]}
GET   /api/health                                 → {ok, players, games:[{id,rows}]}

GET   /api/<game>/scores   ?mode=&size=&rev=&limit=
                                                  → {items:[{id,name,t,s,created_at}]}
POST  /api/<game>/scores   {id, mode, size, rev, t, s}
                                                  → {ok, rank, improved, best:{t,s}}
GET   /api/<game>/stats                           → {game, players, runs, top}
```

身份接口是全局的（`/api/register` 这些），成绩接口是按游戏分目录的（`/api/schulte/scores`）。
不存在的游戏返回 404；老路径 `/api/scores` 已经废掉了。

## 游戏模块契约

`games/<id>/index.js` 导出这几样：

```js
module.exports = {
  id: 'schulte',
  label: '舒尔特方格',
  desc: '按顺序点数字，练视觉搜索',

  variants: { modes: [...], sizes: [...], rev: true },  // 只用于 /api/games 展示

  cmp: (a, b) => a.t - b.t,        // 榜单排序：负数表示 a 排在 b 前

  parseBoard(q) {                  // 变体校验，GET 和 POST 共用
    return { mode, size, rev };    // 或 { error: 'invalid size' }
  },

  parseScore(t, s) {               // 分数校验 + 规范化
    return { t, s };               // 或 { error: 'invalid score' }
  },

  maxBoard: 200                    // 可选：每张榜最多留多少人
};
```

`t` 和 `s` 的语义由各游戏自己定：
舒尔特的 `t` 是本局用时、`s` 是 0–150 的评分；色字和 N-back 的 `t` 是平均反应时、`s` 是答对题数；
记忆矩阵的 `t` 是本局总用时、`s` 是记住的格数。

## 加一个游戏

1. 建 `games/新游戏/index.js`，照上面的契约写 `cmp` / `parseBoard` / `parseScore`；
2. 前端 `新游戏/index.html` 引 `../shared/core.css` 和 `../shared/core.js`；
3. 大厅 `index.html` 加一张卡片。

数据文件 `data/新游戏.json` 第一次写入时自动创建，不用手动建。

## 数据与迁移

每个游戏一个文件，互不干扰：某个游戏的数据坏了、或者你想单独清空它，只动那一个文件。

旧版本只有一个 `data/scores.json`（档案和所有游戏混在一个数组里）。**第一次启动新版本时会自动拆**：
档案进 `players.json`，成绩按 `game` 字段分到各自的文件（没有 `game` 字段的老记录归给 `schulte`），
拆完把旧文件改名为 `scores.json.migrated` 留档，不删。已经拆过的不会重复拆。

备份就是 `cp` 目录：

```bash
tar czf ~/focus-$(date +%F).tar.gz /var/lib/focus
```

## 部署到服务器

### 1. systemd

```ini
# /etc/systemd/system/focus.service
[Unit]
Description=Focus Lab
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/focus/server
Environment=PORT=8090
Environment=ALLOW_ORIGIN=https://fishquito.site
Environment=DATA_DIR=/var/lib/focus
ExecStart=/usr/bin/node /opt/focus/server/server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/focus && sudo chown www-data /var/lib/focus
sudo systemctl daemon-reload && sudo systemctl enable --now focus
sudo systemctl status focus
journalctl -u focus -n 30          # 第一次启动能看到迁移日志
```

### 2. nginx 反代 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name fishquito.site;

    ssl_certificate     /etc/letsencrypt/live/fishquito.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fishquito.site/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 16k;
    }
}
```

```bash
sudo certbot --nginx -d fishquito.site
```

### 3. 前端指向它

用本服务直接托管站点（同源）时**不用配置**，页面会自动探测 `/api/health`。
前端和 API 不同源时，在页面里设：

```js
window.FOCUS_NET = { base: 'https://api.example.com' };
```

（`shared/core.js` 也认旧的 `window.SCHULTE_NET`。）

## 已知取舍

- **JSON 文件而非数据库**：单进程写、量级小（几百到几万人）完全够用；要换 SQLite/Postgres 只改 `lib/store.js` 和各游戏的 `cmp`。
- **一个进程而不是四个服务**：四个游戏共享一份档案，进程内分发比跨服务调用简单得多，小机器上也省内存。想要硬隔离可以拿 nginx 按路径拆，但档案就得跟着拆。
- **档案号即凭证**：没有密码，也没有会话。拿到档案号的人就能用你的档案，这是为了「免注册」付出的代价。
- **防作弊是弱的**：只做了数值区间和限流，无法验证成绩真伪。真要防，需要服务端下发题目种子并校验过程，成本高一个量级。
- **不存 IP**：`ip` 只用于内存里的限流，不落盘。
