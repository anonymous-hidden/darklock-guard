import React, { useState, useRef, useEffect } from 'react';

export default function InputBar({ onSend, disabled, onInterrupt }) {
  const [value, setValue] = useState('');
  const [image, setImage] = useState(null); // { file, preview }
  const [listening, setListening] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const recognitionRef = useRef(null);
  const interruptSentRef = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }, [value]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    if ((!value.trim() && !image) || disabled) return;
    onSend(value.trim(), image);
    setValue('');
    setImage(null);
    interruptSentRef.current = false;
  };

  const handleChange = (e) => {
    setValue(e.target.value);
    // Send interrupt signal on first keystroke (only once per typing session)
    if (!interruptSentRef.current && e.target.value.length > 0 && onInterrupt) {
      onInterrupt();
      interruptSentRef.current = true;
    }
    // Reset when field is cleared
    if (e.target.value.length === 0) {
      interruptSentRef.current = false;
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file);
    setImage({ file, preview, name: file.name });
    e.target.value = '';
  };

  const removeImage = () => {
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setImage(null);
  };

  // Voice-to-text using Web Speech API
  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setValue(text);
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="input-bar">
      {image && (
        <div className="image-preview">
          <img src={image.preview} alt="" />
          <span className="image-preview-name">{image.name}</span>
          <button className="image-preview-remove" onClick={removeImage}>✕</button>
        </div>
      )}
      <div className="input-bar-inner">
        <button className="input-attach" onClick={() => fileRef.current?.click()} title="Attach image">
          ⊕
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <textarea
          ref={taRef}
          className="input-textarea"
          placeholder="Message Nova…"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          rows={1}
          disabled={disabled}
        />
        <button
          className={`input-voice ${listening ? 'active' : ''}`}
          onClick={toggleVoice}
          title={listening ? 'Stop listening' : 'Voice input'}
        >
          ◉
        </button>
        <button className="input-send" onClick={submit} disabled={disabled || (!value.trim() && !image)} title="Send">
          ↑
        </button>
      </div>
    </div>
  );
}
