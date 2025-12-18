"use client";

import MonacoEditor, {
  type EditorProps,
  type OnMount,
} from "@monaco-editor/react";
import { vercelDarkTheme } from "@/lib/monaco-theme";

export function CodeEditor(props: EditorProps) {
  const handleEditorMount: OnMount = (editor, monaco) => {
    monaco.editor.defineTheme("vercel-dark", vercelDarkTheme);
    // monaco.editor.setTheme(resolvedTheme === "dark" ? "vercel-dark" : "light");
    monaco.editor.setTheme("light");

    if (props.onMount) {
      props.onMount(editor, monaco);
    }
  };

  return (
    <MonacoEditor {...props} onMount={handleEditorMount} theme={"light"} />
  );
}
