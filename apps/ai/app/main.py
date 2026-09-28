import uvicorn
from fastapi import FastAPI

from app.api.brand import router as brand_router
from app.api.campaigns import router as campaigns_router
from app.api.insights import router as insights_router
from app.api.knowledge import router as knowledge_router

app = FastAPI(title="AI Service")

app.include_router(brand_router)
app.include_router(campaigns_router)
app.include_router(insights_router)
app.include_router(knowledge_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
