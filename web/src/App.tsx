/**
 * ExamForge 根组件。
 * 组合顶部栏、侧边栏、进度条、主内容区、输入栏,并在挂载时建立 WebSocket 连接。
 * 布局:TopBar 在顶部,下方左侧 Sidebar + 右侧(ProgressBar / MainContent / InputBar)。
 * 在此初始化主题、注册全局快捷键,并根据 focusMode 切换布局。
 */

import { ChoiceModal } from "./components/ChoiceModal";
import { HotkeysHelp } from "./components/HotkeysHelp";
import { ResearchApp } from "./components/research/ResearchApp";
import { useExamForge } from "./hooks/useExamForge";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";

function App() {
  // 建立并维护 WebSocket 连接,取出发送方法
  const { sendEvent } = useExamForge();
  // 注册全局快捷键,并取回帮助面板可见性
  const { showHelp, setShowHelp } = useGlobalHotkeys();
  return (
    <>
      <ResearchApp sendEvent={sendEvent} />
      <ChoiceModal sendEvent={sendEvent} />
      <HotkeysHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}

export default App;
