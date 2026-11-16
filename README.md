# markdown-render-speed-02-v2

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/rezimx-btc/markdown-render-speed-02-v2/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/rezimx-btc/markdown-render-speed-02-v2/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A fresh, dependency-free Markdown renderer that returns exactly the HTML
marked 18.1.3 renders (default options, GFM on). It is a from-scratch
CommonMark 0.31.2 + GFM implementation: a single left-to-right block scan
builds a light tree of raw line slices, link reference definitions are
collected as paragraphs close, and inline text is rendered only after every
definition in the document is known, so forward references resolve. Inline
rendering is one left-to-right pass with a delimiter stack for emphasis,
strong emphasis and strikethrough; there is no token tree and no second
pass over the document. `parse.js` is the whole parser (one exported
`parse(markdown)`); `main.ts` is the driver the harness runs.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

It reads `/input/cases.json` (a JSON array of `{id, markdown}`), renders each
case alone with `parse()`, and writes `/output/html.json` (a JSON array of
the HTML strings, in order). Node 22, no dependencies, no install step.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nht78ayn&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
