from PIL import Image
import io
import base64

# Create a simple 100x100 red image for testing
def create_test_image(filename="test_image.jpg"):
    img = Image.new('RGB', (100, 100), color = 'red')
    img.save(filename)
    print(f"Created test image: {filename}")
    return filename

# Create a test image and return its base64 representation
def get_test_image_base64(filename="test_image.jpg"):
    create_test_image(filename)
    with open(filename, "rb") as img_file:
        return base64.b64encode(img_file.read()).decode('utf-8')

if __name__ == "__main__":
    create_test_image()