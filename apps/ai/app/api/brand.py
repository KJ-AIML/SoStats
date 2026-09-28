from fastapi import APIRouter

from app.api.schemas import BrandContextResponse
from app.rag.context_assembler import assemble_brand_context

router = APIRouter(prefix="/v1/brand", tags=["Brand"])


@router.post("/context", response_model=BrandContextResponse)
def get_brand_context(brand_id: str):
    """
    Retrieve and assemble context for a given brand.
    """
    profile, assembled = assemble_brand_context(brand_id)
    return BrandContextResponse(
        brand_id=brand_id,
        profile=profile,
        assembled_context=assembled
    )
