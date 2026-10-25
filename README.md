# 小游戏合集 · games

这里用于放置多个独立小游戏。**每个游戏一个目录**，各自保存源码、说明和测试，互不混杂。

## 游戏目录

| 游戏 | 简介 | 源码与说明 |
| --- | --- | --- |
| 星际快递：银河远征 | 太空街机小游戏：10 关闯关、无尽模式、连单、道具、临时改装与原创背景音乐 | [stellar-courier](./stellar-courier/) · [游玩说明](./stellar-courier/README.md) |

## 在 Mac 上打开《星际快递》

1. 下载本仓库 ZIP 并解压。
2. 进入 **`stellar-courier`** 文件夹。
3. 双击其中的 **`index.html`**，用 Safari 或 Chrome 打开。

不需要安装依赖、运行终端或联网。请保留游戏目录内的文件结构，不要只复制 HTML 文件。也可以从 [游戏入口文件](./stellar-courier/index.html) 找到源码；GitHub 的文件页面本身不是在线游戏部署。

## 仓库结构

```text
games/
├── README.md                 游戏目录与仓库说明
├── .gitignore                通用忽略规则
└── stellar-courier/          星际快递，独立运行
    ├── index.html
    ├── style.css
    ├── core.js
    ├── audio.js
    ├── input.js
    ├── game.js
    ├── README.md
    └── tests/
```

以后新增游戏时，直接创建同级独立目录，例如 `another-game/`，并在上面的游戏目录表添加一行。无需改动已有游戏的路径或代码。

## 开发者测试

以下命令在**仓库根目录**运行。玩游戏无需运行这些命令。

```sh
node --test stellar-courier/tests/*.test.js
```

浏览器回归测试可只服务该游戏目录：

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory stellar-courier
```

然后打开 `http://127.0.0.1:8765/tests/browser-harness.html`。若直接服务整个仓库根目录，则游戏地址为 `/stellar-courier/`，测试地址为 `/stellar-courier/tests/browser-harness.html`。

每个游戏的运行方式、兼容性与测试范围以其目录内 README 为准。
