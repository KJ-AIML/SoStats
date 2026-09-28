from app.api.schemas import BrandProfile


def assemble_brand_context(brand_id: str) -> tuple[BrandProfile, str]:
    """
    Mock function to assemble brand context.
    Later this will fetch from DB / Vector store.
    """
    # Mock data
    profile = BrandProfile(
        voice="Friendly, professional, and slightly witty",
        audience="Tech-savvy millennials and Gen Z creators",
        products=["Creator Pro Software", "Content AI Plugin", "Analytics Dashboard"],
        pillars=["Innovation", "Creativity", "Empowerment", "Community"]
    )

    # Mock assembled context string for LLMs
    assembled = (
        f"Brand ID: {brand_id}\n"
        f"Voice: {profile.voice}\n"
        f"Audience: {profile.audience}\n"
        f"Products: {', '.join(profile.products)}\n"
        f"Core Pillars: {', '.join(profile.pillars)}\n"
        "This context should guide the tone and content of the generated response."
    )

    return profile, assembled
