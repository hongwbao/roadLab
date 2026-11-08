---
name: 路网工坊（实现暂名）
description: 以满屏三维地形和浮动游戏 HUD 建造道路的中文桌面原型；当前实现记录。
colors:
  panel: "#263540f5"
  panel-raised: "#344752"
  line: "#536873"
  text: "#e4edf1"
  muted: "#b4c7d0"
  blue: "#62c3f0"
  button-hover: "#465f6d"
  primary: "#467c69"
  primary-hover: "#3d705d"
  white: "#fff"
  input: "#1d2b33"
  input-line: "#617581"
  tool-active: "#355d73"
  tool-active-line: "#6bbde3"
  tool-active-text: "#e5f6ff"
  demolition-tool: "#914b3b"
  demolition-tool-line: "#ffb195"
  demolition-tool-text: "#fff0e6"
  asset: "#334651"
  asset-line: "#536a76"
  asset-selected: "#315e78"
  asset-selected-line: "#87d3f3"
  snap-feedback: "#73572bf5"
  snap-feedback-text: "#fff0c9"
  terrain-clear: "#8ca77c"
  preview-surface: "#63baf1"
  preview-line: "#9de2ff"
  snap-marker: "#ffcf70"
  demolition-surface: "#f15b48"
typography:
  brand:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 16px
    letterSpacing: 0.02em
  panel-title:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 600
  dialog-title:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 18px
    fontWeight: 600
  body:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 13px
  label:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 11px
  asset-label:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.5
  detail:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 10px
  statistic:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 500
  category:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: 12px
rounded:
  field: 4px
  control: 5px
  asset: 6px
  toolbar: 7px
  panel: 8px
  dock: 9px
  dialog: 10px
spacing:
  tight: 3px
  xs: 4px
  sm: 5px
  control-gap: 7px
  md: 8px
  asset-gap: 9px
  lg: 12px
  group: 14px
  panel: 16px
  viewport: 18px
  dialog: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 8px 11px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 8px 11px
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  button-active:
    backgroundColor: "{colors.tool-active}"
    textColor: "{colors.tool-active-text}"
    rounded: "{rounded.control}"
  button-demolition:
    backgroundColor: "{colors.demolition-tool}"
    textColor: "{colors.demolition-tool-text}"
    rounded: "{rounded.control}"
    size: 38px
    padding: 9px
  field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: 5px 7px
  asset-category:
    textColor: "#bacbd4"
    rounded: "0"
    typography: "{typography.category}"
    padding: 10px 13px
  road-asset:
    backgroundColor: "{colors.asset}"
    textColor: "{colors.text}"
    typography: "{typography.asset-label}"
    rounded: "{rounded.asset}"
    padding: 5px 6px 8px
    width: 132px
  road-asset-selected:
    backgroundColor: "{colors.asset-selected}"
  floating-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: 16px
  road-dock:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.dock}"
    padding: 0 12px 9px
  snap-feedback:
    backgroundColor: "{colors.snap-feedback}"
    textColor: "{colors.snap-feedback-text}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: 7px 10px
  traffic-control:
    textColor: "{colors.text}"
    typography: "{typography.detail}"
    width: 235px
  alignment-control:
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: 5px 8px
---

# Design System: 路网工坊（实现暂名）

## Overview

**Creative North Star: "当前实现描述：地形上的道路建造 HUD"**

用户已指定熟悉的道路建造游戏操作方式；本记录对应已实现的满屏三维地图、底部道路资产和按需浮层。暂名、具体配色及这里的定性称呼仍是实现选择，不是用户确认的品牌承诺。

视觉重点是地形中的道路几何、放置预览与车流；深石板色 HUD 靠视口边缘悬浮，紧凑中文标签配合描边图标与程序生成的道路 SVG 缩略图。道路选择和工具选择采用蓝色状态，吸附与拆除另有明确反馈。没有采用生成图片或光栅设计稿作为视觉权威。

事实来源为 PRODUCT.md、编辑器 surface brief、src/style.css、src/main.ts、src/render/scene.ts、src/editor/editor.ts 与 src/core/snapping.ts；同时查看了现存 desktop、mobile、boundaries 截图以核对基础 HUD 布局，新增偏移对齐行为来自源码，未把旧截图当作该行为的验证。该记录没有采样浏览器计算样式，也不代表完整交互或可访问性审查通过。

**Key Characteristics:**

- 满屏三维地形持续承载操作，浮动 HUD 沿上边缘、左下和底部排布。
- 道路按分类呈现为带车道与方向线索的 SVG 资产卡，建造方式紧随其后。
- 蓝色预览、琥珀吸附与红色拆除各有独立语义，不能互换。
- 桌面键鼠优先；窄屏保留资产横滚，并将车流调节放到测试栏第二行。

## Colors

前置 token 是颜色值的规范来源。深石板控制面与浅冷色文字构成 HUD；选择蓝、测试操作绿及反馈琥珀/红各自服务操作状态。侧文件的色阶是合成预览，并非已实现的额外调色板。

### Primary

- **选择与焦点蓝（blue）**：分类底线、键盘焦点与活动控件的共同提示；按钮选中使用 tool-active 一组，资产选中使用 asset-selected 一组，保留实际差异。
- **建造蓝（preview-surface、preview-line）**：Three.js 道路 ghost 材料与边线；ghost 透明度为（0.45）。这些是场景材料值，不是 DOM 背景，也不保证与截图的最终像素相同。

### Secondary

- **测试绿（primary、primary-hover）**：开始/暂停车流测试等主要按钮的底色。
- **吸附琥珀（snap-marker、snap-feedback、snap-feedback-text）**：实际端点、路段或偏移吸附时的场景圆环与 DOM 说明气泡；偏移气泡包含左/右缘和米数，普通网格对齐提示仍采用蓝底。
- **拆除珊瑚（demolition-surface）**：地图中待拆道路的悬停覆盖材料，透明度为（0.72）。拆除工具使用 demolition-tool 一组；模式徽标另有现成棕红底，不把不同实现值混作一个 token。

### Neutral

- **浮动石板（panel、panel-raised）**：半透明 HUD 主面与常规按钮面；浮动面保留原有带 alpha 的十六进制值，不改写为另一套来源。
- **冷色正文与辅助字（text、muted）**：HUD 主文字与次级说明；地形上的地图名另用深色文字。
- **输入暗面与轮廓（input、input-line）**：数字与名称字段。
- **资产底与边线（asset、asset-line）**：道路卡片静止状态；line 用于常规分隔。
- **地形后备底（terrain-clear）**：CSS 页面底与 WebGL clear color。实际地形是受光照影响的三维材料，不是这一背景色的平铺图片。

**The Distinct Feedback Rule.** 资产选择、建造预览、吸附与拆除分别保留自身反馈；琥珀表示已经吸附，红色拆除必须同时有工具与模式文字。

## Typography

**Body Font:** Noto Sans SC，依次回退 Microsoft YaHei、system-ui、sans-serif。当前没有独立展示字体或等宽字体，也未从远端加载字体。

字阶以中文游戏 HUD 的紧凑读取为目的，而非大标题叙事。基础正文见 body；顶栏暂名见 brand，浮层标题见 panel-title，对话框标题见 dialog-title；资产名见 asset-label，工具与说明见 label，底栏辅助字见 detail，统计值见 statistic。分类页签使用 category。品牌文字的字重继承 strong 的浏览器默认值，代码没有单独声明，故未伪造数值 token。

道路卡名行高为（1.5），辅助段落通常为（1.8），帮助列表为（1.9）；没有全局固定正文行高。数字输入、道路数据、车流目标与统计采用 tabular-nums。窄屏的品牌、资产名和统计会缩小，局部状态提示可到（9px）；这是现有密度事实，不作为新增表面的通用最小字号承诺。

## Layout

当前编辑器占满（100dvh），页面不滚动，三维视口绝对定位铺满工作区。顶栏位于左上（left 18px / top 15px），高（46px）；相机控件位于右上（right 18px / top 16px）。项目名称、保存状态与历史/菜单/帮助操作在顶栏内，地图名称和路网概况直接覆盖地形。

道路资产浮坞位于底部中央（bottom 82px），宽（min(930px, calc(100% - 174px))）。分类在上，资产横向排列在中，直线/曲线/升级、道路高度、吸附与单向接口对齐控制在下。工具行允许横向滚动，避免新增对齐控制挤走操作。默认资产宽（132px）、最小高（87px），缩略图（120px × 52px），卡间距见 asset-gap。左下工具轨与资产坞底边对齐，工具尺寸（38px × 38px）。

道路信息只在选择模式且存在当前道路时显示于右上（267px 宽）；边界通行口说明仅在通行口模式显示于左侧（270px 宽）。拆除或通行口模式收起资产坞；点击左下道路资产按钮可直接退出这两种模式并重新打开资产。模板和地图菜单也是按需浮层。道路信息与模板在自身最大高度内滚动。

底部测试栏固定满宽，高（58px），含运行/重置、倍速、实时车流、统计与通行口入口。车流控制常规宽（235px），滑块与百分比数字框并列。它控制正在运行的模拟；调整不会重置车辆或计数。

宽度不超过（1250px）时，隐藏资产说明和部分底栏信息，视图按钮采用图标。宽度不超过（930px）时，测试栏增高至（104px），车流控制独占第二行，资产坞和工具轨底距增至（129px），隐藏平均通行统计。宽度不超过（600px）时，外缘留白约（9px），道路坞宽为（calc(100% - 66px)）并向右避开工具轨；资产宽缩至（112px）、缩略图（102px × 43px），分类和资产继续横滚。相机控件移到顶栏下方，选择/通行口面板收窄，底栏通行口按钮隐藏。此适配维持可用布局，不宣称完成触屏建造模式。

## Elevation & Depth

场景本身提供空间深度；DOM 外壳以近不透明石板面、圆角、边线和浅投影浮于地形上。没有背景模糊或图片纹理。顶栏、道路坞、按需面板、吸附提示与 toast 各有局部阴影；对话框另有遮罩。准确阴影保存在侧文件，不塞入只支持有限属性的 frontmatter 组件 token。

**The Geometry First Rule.** 该编辑器的常规建造发生在地图上；信息浮层只在相应选择或工具状态出现。

状态切换只使用背景/边框色的（0.12s ease-out）过渡；prefers-reduced-motion 关闭 CSS transition。车流与建造预览由实时场景驱动，不能据此声称它们也被该媒体查询暂停。

## Shapes

形态是紧凑、有边框的游戏控件：字段见 field 圆角，普通按钮见 control，资产卡见 asset，顶栏和相机条见 toolbar，信息浮层与左下轨道见 panel，资产坞见 dock，对话框见 dialog。分类采用直角页签和底部（2px）选择线，资产选中另有向内的底部强调线。SVG 线性图标常规（18px），Lucide 描边宽（1.8）；道路缩略图由车道数据直接生成 SVG，区别于普通操作图标。

## Components

### Buttons

按钮紧凑且有明确状态。常规底色与文字见 button-secondary，最小高（34px）；primary 用于开始/暂停测试。工具轨按钮默认透明，当前工具使用 button-active；拆除工具使用 button-demolition。禁用透明度为（0.35），焦点为（2px）blue 轮廓、偏移（3px）；画布焦点向内偏移（-3px）。图标按钮通过 aria-label/title 保留名称。

### Inputs / Fields

名称与数字框使用 field；普通最小高（30px）、细边框（1px）。顶栏名称在静止时透明且边框隐藏，悬停露出边线。底栏百分比框宽（48px）、最小高（24px）、字号（11px）；range 最小高（22px），原生滑块采用蓝色 accent-color。全局车流范围（0–400%）；选中道路的入口基准流量范围（0–240 辆/分），只在相应通行口存在时出现。选中道路另有独立的最高限速输入（5–160 km/h），使用相同 field 风格、64px宽度及等宽数字；普通编辑事务支持撤销及存档。

### Navigation

道路分类为横向可滚动页签，静止透明、选中显示亮色字与蓝色底线。分类与资产各自用 aria-pressed 表达状态；直线/曲线/升级是另一个独立工具组。地图/历史与相机控制分居顶角，模板和文件操作在菜单中展开。

### Road Asset Cards

资产卡是界面的核心可复用组件。静止与选中色见 road-asset / road-asset-selected；SVG 呈现车道数量、方向箭头和过渡形态，卡下为紧凑中文名称。悬停改变卡面与边线；选中保留亮蓝描边与内侧底线。选择资产后地图立即显示建造 ghost，不能仅改变卡片颜色。

### Context Panels

浮层卡片使用 floating-panel；标题与关闭按钮同排，下方为道路长度、速度、高度和当前操作。更多几何操作折叠在 details 中；道路通行口的流量设置只随选中道路出现。通行口说明解释端点点击与右键取消，并提供自动识别操作，不把它扩展成常驻配置表。

### Alignment Control

建造时，单向资产显示“对齐：自动 / 中线 / 左缘 / 右缘”按钮，双向资产隐藏。地图画布聚焦时，Tab循环建造的车道候选或对齐方式。成功吸附仍使用琥珀提示及偏移米数。

道路升级替换时，单向、双向均显示“替换对齐”按钮。自动模式按鼠标横向位置在中线、同向连续旧车道组及边缘方案之间选择；Tab／Shift＋Tab或按钮固定／循环当前可用方案。两车道换单车道可保留原第1或第2车道的物理位置。计算包括非对称道路及中央隔离带宽度。按钮仍用紧凑透明底与label字号，保持现有HUD。

悬停替换隐藏旧道路、旧路口铺面及其标线，用既有蓝色半透明材质显示新断面和路口，离开或退出时恢复。预览读取独立地图副本，不写入存档；实际替换使用同一偏移结果，右键保留恢复最近一次断面的交互。

### Feedback / Mode Badge

画布指针附近的反馈气泡不拦截指针；端点、路段和偏移吸附均使用 snap-feedback，圆环使用 snap-marker；偏移状态另外标注方向与米数。底部模式徽标显示选择、建造、升级、拆除或通行口；拆除时徽标和工具都转为暖红。toast 位于资产坞上方并使用 role=status；它反馈动作结果，不取代持续的模式标识。

### Simulation Bar

固定底栏将开始/暂停、（1× / 2× / 4×）速度、车流目标、百分比与统计放在连续控制面上。页脚“设置通行口”进入手动端点设置模式；自动识别仍是通行口说明面板中的独立按钮。计数使用等宽数字特性；车流目标输出无需每帧播报。窄屏把车流移到第二行，保留运行按钮与核心统计，不把测试控制塞入道路属性层。

## Do's and Don'ts

### Do:

- **Do** 让道路 SVG 缩略图表达车道与方向，并保留资产卡、分类和建造方式的独立选择状态。
- **Do** 保留蓝色 focus-visible、按钮可访问名称与 aria-pressed，不以悬停颜色替代键盘焦点。
- **Do** 在窄屏保留道路资产横滚、车流第二行和地图操作区；桌面键鼠仍是当前编辑目标。
- **Do** 把 Three.js 材料值、CSS 状态值和扩展中的合成色阶分别解释。

### Don't:

- **Don't** 将暂名、当前配色或“Creative North Star”的记录性称呼描述为用户批准的品牌承诺。
- **Don't** 把已替换的浅色三列表单工作台、常驻道路列表或常驻属性栏写成当前界面。
- **Don't** 把蓝色建造、琥珀吸附与红色拆除合并成同一高亮语义。
- **Don't** 把窄屏适配、现存截图或本次文档校验表述为完整移动触控体验或全局审查通过。
