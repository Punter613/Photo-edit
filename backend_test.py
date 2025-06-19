import pytest
import requests
import os
import json
import base64
from pathlib import Path
import sys
from datetime import datetime
import time

# Add the current directory to the path so we can import the test_image module
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from test_image import create_test_image, get_test_image_base64

# Get the backend URL from the frontend .env file
def get_backend_url():
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    return None

# Get the backend URL
BACKEND_URL = get_backend_url()
if not BACKEND_URL:
    raise ValueError("Could not find BACKEND_URL in frontend/.env")

API_URL = f"{BACKEND_URL}/api"
print(f"Using API URL: {API_URL}")

# Test data
TEST_IMAGE_PATH = "test_image.jpg"

# Create test image
create_test_image(TEST_IMAGE_PATH)

def test_health_check():
    """Test the health check endpoint"""
    print("\n--- Testing Health Check Endpoint ---")
    start_time = time.time()
    response = requests.get(f"{API_URL}/")
    end_time = time.time()
    
    print(f"Response time: {end_time - start_time:.4f} seconds")
    print(f"Status code: {response.status_code}")
    print(f"Response: {response.json()}")
    
    assert response.status_code == 200
    assert "message" in response.json()
    assert "AI Image Editor API" in response.json()["message"]

def test_age_verification():
    """Test the age verification endpoint"""
    print("\n--- Testing Age Verification Endpoint ---")
    payload = {
        "verified": True,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    start_time = time.time()
    response = requests.post(f"{API_URL}/age-verify", json=payload)
    end_time = time.time()
    
    print(f"Response time: {end_time - start_time:.4f} seconds")
    print(f"Status code: {response.status_code}")
    print(f"Response: {response.json()}")
    
    assert response.status_code == 200
    assert response.json()["status"] == "verified"

def test_upload_image():
    """Test the image upload endpoint"""
    print("\n--- Testing Image Upload Endpoint ---")
    
    # Prepare the file for upload
    with open(TEST_IMAGE_PATH, "rb") as img_file:
        files = {"file": (TEST_IMAGE_PATH, img_file, "image/jpeg")}
        
        start_time = time.time()
        response = requests.post(f"{API_URL}/upload-image", files=files)
        end_time = time.time()
    
    print(f"Response time: {end_time - start_time:.4f} seconds")
    print(f"Status code: {response.status_code}")
    print(f"Response keys: {list(response.json().keys())}")
    
    assert response.status_code == 200
    assert "id" in response.json()
    assert "base64" in response.json()
    assert "filename" in response.json()
    assert "size" in response.json()
    
    # Save the image ID for later tests
    image_id = response.json()["id"]
    image_base64 = response.json()["base64"]
    return image_id, image_base64

def test_create_mask(image_base64):
    """Test the mask creation endpoint"""
    print("\n--- Testing Create Mask Endpoint ---")
    
    # Create a simple mask (rectangle in the middle of the image)
    mask_data = json.dumps([[25, 25, 75, 75]])  # x1, y1, x2, y2
    
    payload = {
        "image_base64": image_base64,
        "mask_data": mask_data
    }
    
    start_time = time.time()
    response = requests.post(f"{API_URL}/create-mask", data=payload)
    end_time = time.time()
    
    print(f"Response time: {end_time - start_time:.4f} seconds")
    print(f"Status code: {response.status_code}")
    print(f"Response keys: {list(response.json().keys())}")
    
    assert response.status_code == 200
    assert "mask_base64" in response.json()
    
    return response.json()["mask_base64"]

def test_edit_history():
    """Test the edit history endpoint"""
    print("\n--- Testing Edit History Endpoint ---")
    
    start_time = time.time()
    response = requests.get(f"{API_URL}/edit-history")
    end_time = time.time()
    
    print(f"Response time: {end_time - start_time:.4f} seconds")
    print(f"Status code: {response.status_code}")
    print(f"Response keys: {list(response.json().keys())}")
    
    assert response.status_code == 200
    assert "history" in response.json()

def test_environment_variables():
    """Test that environment variables are properly loaded"""
    print("\n--- Testing Environment Variables ---")
    
    # We can't directly access the environment variables in the backend,
    # but we can infer if they're loaded by testing the endpoints that use them
    
    # Test if REPLICATE_API_KEY is loaded by checking if the health check endpoint works
    response = requests.get(f"{API_URL}/")
    assert response.status_code == 200, "Health check failed, REPLICATE_API_KEY might not be loaded"
    
    # Test if MongoDB connection is working by testing the age verification endpoint
    payload = {
        "verified": True,
        "timestamp": datetime.utcnow().isoformat()
    }
    response = requests.post(f"{API_URL}/age-verify", json=payload)
    assert response.status_code == 200, "Age verification failed, MongoDB connection might not be working"
    
    print("Environment variables appear to be properly loaded")

def run_all_tests():
    """Run all tests in sequence"""
    print("\n=== Starting Backend API Tests ===")
    print(f"Testing API at: {API_URL}")
    
    try:
        # Test health check
        test_health_check()
        
        # Test environment variables
        test_environment_variables()
        
        # Test age verification
        test_age_verification()
        
        # Test image upload
        image_id, image_base64 = test_upload_image()
        
        # Test mask creation
        mask_base64 = test_create_mask(image_base64)
        
        # Test edit history
        test_edit_history()
        
        print("\n=== All tests passed successfully! ===")
        return True
    except Exception as e:
        print(f"\n=== Test failed: {str(e)} ===")
        return False

if __name__ == "__main__":
    run_all_tests()