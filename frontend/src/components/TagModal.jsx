import { useState } from "react";

export default function TagModal({ title, actionLabel, onClose, onSubmit, defaultValue = "" }) {
  const [value, setValue] = useState(defaultValue);

  const handleSubmit = (event) => {
    event.preventDefault();
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    onSubmit(tags);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <label className="field">
            <span>タグ入力（カンマ区切り）</span>
            <input
              type="text"
              placeholder="AI, OpenAI, 考察"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="primary" type="submit">
              {actionLabel}
            </button>
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}