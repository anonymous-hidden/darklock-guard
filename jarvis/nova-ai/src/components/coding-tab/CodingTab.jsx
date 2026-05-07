import React, { useState, useCallback } from 'react';
import FileTree from './FileTree.jsx';
import CodeEditor from './CodeEditor.jsx';
import AICodeAssistant from './AICodeAssistant.jsx';
import Terminal from './Terminal.jsx';

export default function CodingTab() {
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState('');

  const onOpen = useCallback((node) => {
    if (!node || node.type !== 'file') return;
    setActiveFile(node.path);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="w-64 shrink-0">
          <FileTree activePath={activeFile} onOpen={onOpen} />
        </div>
        <div className="flex-1 flex min-w-0">
          <CodeEditor
            filePath={activeFile}
            onContentChange={({ content }) => setFileContent(content || '')}
          />
        </div>
        <div className="w-[380px] shrink-0">
          <AICodeAssistant filePath={activeFile} fileContent={fileContent} />
        </div>
      </div>
      <div className="h-48 shrink-0">
        <Terminal />
      </div>
    </div>
  );
}
