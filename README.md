# RSS Reader (React + FastAPI + SQLite)

## 構成
- `backend/`: FastAPI + SQLite API
- `frontend/`: React (Vite)

## セットアップ

### Backend
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8002
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 補足
- DBは `backend/data/rss_reader.db` に作成されます。
- `backend/schema.sql` にDDLが格納されています。