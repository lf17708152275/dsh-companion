# dsh-companion

把人格卡变成 DSH 的 agent preset：一张卡 = 一个 preset，人格卡正文就是该 preset 的**全部系统提示词**。

A2A 入站端点按 preset 选人格，于是"给谁用什么人格"退化成端点配置，桥接侧（微信 bot）不再拼人设 prompt。

## 安装

```bash
dsh plugin --profile web add /path/to/dsh-companion
sudo systemctl restart dsh-web.service   # 插件在 host 层注册 preset，需重启
```

安装后 profile 的 `dsh.profile.bundles` 会多出 `dsh-companion`。

## 生成卡片

```bash
pnpm cards -- ~/cards               # 读 <目录>/NN-名字/人格卡.md → cards/*.json
pnpm cards -- <源目录> <输出目录>
```

- 每张卡取 `人格卡.md`：正文（〇～十节）作为 `persona`，`## 十一、快速切换` 起的人类元信息不进入 prompt
- `角色名` → preset 显示名，`一句话系统提示` → preset 描述
- `QQ` → `微信`（桥接的是微信）
- 卡片 id 用源目录两位编号（`22`），preset id 为 `card-22`

## 配置（profile patch 层，可选）

```yaml
- id: companion
  config:
    cardsDir: /path/to/cards      # 默认用包内 cards/，可指向自定义卡库
    presetPrefix: card-           # preset id 前缀
    orderBase: 100                # preset 排序起点（标准 preset 是 1/3）
```

## 在 DSH 里编辑人格卡

插件带一个 client 半边：installed 之后，DSH 的 **设置 → 插件 → dsh-companion** 页面里会出现卡片编辑器。

- 左侧 23 张卡列表，右侧改 **名字 / 描述 / 人设正文**，保存后该卡的 preset **立即重新注册**（新会话生效；已开会话沿用旧修订）
- 「恢复内置」删掉本地覆盖，回到包内版本
- 覆盖写在 `~/.dsh/companion/cards/<id>.json`（`DSH_HOME` 可改），升级包不会丢编辑
- 接口：`GET /x-dsh-companion/api/cards`、`POST .../cards/save`、`POST .../cards/reset`

## 验证

```bash
pnpm test    # node:test：加载/定义/注册/失败容忍/生成器
```

注册失败的单张卡只打警告，不影响其它卡；插件整体只依赖 `agentPresets` 服务，没有宿主机型依赖。
