from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import replicate
import base64
import aiofiles
from PIL import Image, ImageDraw
import io
import httpx
from typing import Dict, Any

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="AI Image Editor API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Ensure uploads directory exists
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Models
class ImageEditRequest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    operation_type: str  # "remove_object", "add_object", "inpaint"
    prompt: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ImageEditResponse(BaseModel):
    id: str
    result_image_base64: str
    operation_type: str
    processing_time: float

class AgeVerification(BaseModel):
    verified: bool
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# Initialize Replicate client
try:
    replicate_client = replicate.Client(api_token=os.getenv("REPLICATE_API_KEY"))
    logging.info("Replicate client initialized successfully")
except Exception as e:
    logging.error(f"Failed to initialize Replicate client: {e}")
    replicate_client = None

def image_to_base64(image_path_or_bytes):
    """Convert image to base64 string"""
    if isinstance(image_path_or_bytes, (str, Path)):
        with open(image_path_or_bytes, "rb") as img_file:
            return base64.b64encode(img_file.read()).decode('utf-8')
    else:
        return base64.b64encode(image_path_or_bytes).decode('utf-8')

async def download_image_as_base64(url: str) -> str:
    """Download image from URL and convert to base64"""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return base64.b64encode(response.content).decode('utf-8')

# Routes
@api_router.get("/")
async def root():
    return {"message": "AI Image Editor API - Ready to process images!"}

@api_router.post("/age-verify")
async def age_verify(verification: AgeVerification):
    """Store age verification status"""
    await db.age_verifications.insert_one(verification.dict())
    return {"status": "verified", "message": "Age verification completed"}

@api_router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """Upload and store image, return base64"""
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{file_id}.{file_extension}"
    file_path = UPLOAD_DIR / filename
    
    # Save file
    content = await file.read()
    async with aiofiles.open(file_path, 'wb') as f:
        await f.write(content)
    
    # Convert to base64
    image_base64 = image_to_base64(content)
    
    # Store in database
    image_record = {
        "id": file_id,
        "filename": filename,
        "original_name": file.filename,
        "content_type": file.content_type,
        "size": len(content),
        "base64_data": image_base64,
        "timestamp": datetime.utcnow()
    }
    await db.images.insert_one(image_record)
    
    return {
        "id": file_id,
        "filename": filename,
        "base64": image_base64,
        "size": len(content)
    }

@api_router.post("/create-mask")
async def create_mask(
    image_base64: str = Form(...),
    mask_data: str = Form(...)  # JSON string of mask coordinates
):
    """Create a mask from user-drawn areas"""
    try:
        # Decode base64 image
        image_data = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_data))
        
        # Create mask image
        mask = Image.new('L', image.size, 0)  # Black mask
        draw = ImageDraw.Draw(mask)
        
        # Parse mask data (simplified - expecting coordinates)
        import json
        mask_coords = json.loads(mask_data)
        
        # Draw white areas where user wants to edit
        for coords in mask_coords:
            if len(coords) >= 4:  # x1, y1, x2, y2
                draw.rectangle(coords, fill=255)
        
        # Convert mask to base64
        mask_io = io.BytesIO()
        mask.save(mask_io, format='PNG')
        mask_base64 = base64.b64encode(mask_io.getvalue()).decode('utf-8')
        
        return {"mask_base64": mask_base64}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create mask: {str(e)}")

@api_router.post("/remove-object")
async def remove_object(
    image_base64: str = Form(...),
    mask_base64: str = Form(...),
    prompt: str = Form("remove the selected object")
):
    """Remove objects from image using AI inpainting"""
    if not replicate_client:
        raise HTTPException(status_code=500, detail="Replicate API not configured. Please set REPLICATE_API_KEY.")
    
    try:
        start_time = datetime.utcnow()
        
        # Decode images
        image_data = base64.b64decode(image_base64)
        mask_data = base64.b64decode(mask_base64)
        
        # Create temporary files for Replicate
        image_path = UPLOAD_DIR / f"temp_image_{uuid.uuid4()}.png"
        mask_path = UPLOAD_DIR / f"temp_mask_{uuid.uuid4()}.png"
        
        async with aiofiles.open(image_path, 'wb') as f:
            await f.write(image_data)
        async with aiofiles.open(mask_path, 'wb') as f:
            await f.write(mask_data)
        
        # Run Replicate inpainting model
        output = replicate_client.run(
            "zsxkib/flux-dev-inpainting",
            input={
                "image": open(image_path, "rb"),
                "mask": open(mask_path, "rb"),
                "prompt": prompt,
                "strength": 0.95,
                "guidance_scale": 7.5,
                "num_inference_steps": 50
            }
        )
        
        # Download and convert result to base64
        result_url = output[0] if isinstance(output, list) else output
        result_base64 = await download_image_as_base64(result_url)
        
        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        # Store result
        edit_record = ImageEditRequest(
            operation_type="remove_object",
            prompt=prompt
        )
        
        response = ImageEditResponse(
            id=edit_record.id,
            result_image_base64=result_base64,
            operation_type="remove_object",
            processing_time=processing_time
        )
        
        await db.image_edits.insert_one({
            **edit_record.dict(),
            **response.dict()
        })
        
        # Clean up temp files
        image_path.unlink(missing_ok=True)
        mask_path.unlink(missing_ok=True)
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove object: {str(e)}")

@api_router.post("/add-object")
async def add_object(
    image_base64: str = Form(...),
    prompt: str = Form(...),
    mask_base64: Optional[str] = Form(None)
):
    """Add objects to image using AI"""
    if not replicate_client:
        raise HTTPException(status_code=500, detail="Replicate API not configured. Please set REPLICATE_API_KEY.")
    
    try:
        start_time = datetime.utcnow()
        
        # Decode image
        image_data = base64.b64decode(image_base64)
        image_path = UPLOAD_DIR / f"temp_image_{uuid.uuid4()}.png"
        
        async with aiofiles.open(image_path, 'wb') as f:
            await f.write(image_data)
        
        # Use image-to-image model for adding objects
        input_data = {
            "image": open(image_path, "rb"),
            "prompt": prompt,
            "strength": 0.7,
            "guidance_scale": 7.5,
            "num_inference_steps": 50
        }
        
        # If mask provided, use inpainting
        if mask_base64:
            mask_data = base64.b64decode(mask_base64)
            mask_path = UPLOAD_DIR / f"temp_mask_{uuid.uuid4()}.png"
            async with aiofiles.open(mask_path, 'wb') as f:
                await f.write(mask_data)
            input_data["mask"] = open(mask_path, "rb")
            model = "zsxkib/flux-dev-inpainting"
        else:
            model = "black-forest-labs/flux-dev"
        
        output = replicate_client.run(model, input=input_data)
        
        # Download and convert result to base64
        result_url = output[0] if isinstance(output, list) else output
        result_base64 = await download_image_as_base64(result_url)
        
        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        # Store result
        edit_record = ImageEditRequest(
            operation_type="add_object",
            prompt=prompt
        )
        
        response = ImageEditResponse(
            id=edit_record.id,
            result_image_base64=result_base64,
            operation_type="add_object",
            processing_time=processing_time
        )
        
        await db.image_edits.insert_one({
            **edit_record.dict(),
            **response.dict()
        })
        
        # Clean up temp files
        image_path.unlink(missing_ok=True)
        if mask_base64 and 'mask_path' in locals():
            mask_path.unlink(missing_ok=True)
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add object: {str(e)}")

@api_router.post("/text-guided-edit")
async def text_guided_edit(
    image_base64: str = Form(...),
    prompt: str = Form(...),
    negative_prompt: Optional[str] = Form("blurry, low quality")
):
    """Perform text-guided image editing"""
    if not replicate_client:
        raise HTTPException(status_code=500, detail="Replicate API not configured. Please set REPLICATE_API_KEY.")
    
    try:
        start_time = datetime.utcnow()
        
        # Decode image
        image_data = base64.b64decode(image_base64)
        image_path = UPLOAD_DIR / f"temp_image_{uuid.uuid4()}.png"
        
        async with aiofiles.open(image_path, 'wb') as f:
            await f.write(image_data)
        
        # Use InstuctPix2Pix for text-guided editing
        output = replicate_client.run(
            "timothybrooks/instruct-pix2pix",
            input={
                "image": open(image_path, "rb"),
                "prompt": prompt,
                "num_inference_steps": 50,
                "image_guidance_scale": 1.2,
                "guidance_scale": 7.5
            }
        )
        
        # Download and convert result to base64
        result_url = output[0] if isinstance(output, list) else output
        result_base64 = await download_image_as_base64(result_url)
        
        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        # Store result
        edit_record = ImageEditRequest(
            operation_type="text_guided_edit",
            prompt=prompt
        )
        
        response = ImageEditResponse(
            id=edit_record.id,
            result_image_base64=result_base64,
            operation_type="text_guided_edit",
            processing_time=processing_time
        )
        
        await db.image_edits.insert_one({
            **edit_record.dict(),
            **response.dict()
        })
        
        # Clean up temp files
        image_path.unlink(missing_ok=True)
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to perform text-guided edit: {str(e)}")

@api_router.get("/edit-history")
async def get_edit_history():
    """Get user's editing history"""
    edits = await db.image_edits.find().sort("timestamp", -1).limit(50).to_list(50)
    return {"history": edits}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()