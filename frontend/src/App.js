import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Age Verification Modal Component
const AgeVerificationModal = ({ isOpen, onVerify }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-center mb-4 text-gray-800">Age Verification Required</h2>
        <p className="text-gray-600 text-center mb-6">
          This application may process adult content. You must be 18 or older to continue.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => onVerify(true)}
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 transition-colors"
          >
            I am 18 or older
          </button>
          <button
            onClick={() => onVerify(false)}
            className="bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700 transition-colors"
          >
            I am under 18
          </button>
        </div>
      </div>
    </div>
  );
};

// Drawing Canvas Component for Mask Creation
const DrawingCanvas = ({ imageData, onMaskCreated, isVisible }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskAreas, setMaskAreas] = useState([]);

  useEffect(() => {
    if (imageData && isVisible) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${imageData}`;
    }
  }, [imageData, isVisible]);

  const startDrawing = (e) => {
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMaskAreas([...maskAreas, { startX: x, startY: y, endX: x, endY: y }]);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newAreas = [...maskAreas];
    newAreas[newAreas.length - 1].endX = x;
    newAreas[newAreas.length - 1].endY = y;
    setMaskAreas(newAreas);

    // Draw selection rectangle
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Redraw image
    if (imageData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = `data:image/jpeg;base64,${imageData}`;
    }

    // Draw mask areas
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    
    newAreas.forEach(area => {
      const width = area.endX - area.startX;
      const height = area.endY - area.startY;
      ctx.fillRect(area.startX, area.startY, width, height);
      ctx.strokeRect(area.startX, area.startY, width, height);
    });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    onMaskCreated(maskAreas);
  };

  const clearMask = () => {
    setMaskAreas([]);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (imageData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = `data:image/jpeg;base64,${imageData}`;
    }
  };

  if (!isVisible) return null;

  return (
    <div className="mt-4">
      <div className="flex gap-2 mb-2">
        <button
          onClick={clearMask}
          className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
        >
          Clear Selection
        </button>
        <p className="text-sm text-gray-600 self-center">
          Click and drag to select areas for editing
        </p>
      </div>
      <canvas
        ref={canvasRef}
        className="border border-gray-300 cursor-crosshair max-w-full"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
    </div>
  );
};

function App() {
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [showAgeModal, setShowAgeModal] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedImageBase64, setSelectedImageBase64] = useState('');
  const [editMode, setEditMode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultImage, setResultImage] = useState('');
  const [showCanvas, setShowCanvas] = useState(false);
  const [maskAreas, setMaskAreas] = useState([]);
  const [editHistory, setEditHistory] = useState([]);
  const fileInputRef = useRef(null);

  const handleAgeVerification = async (isVerified) => {
    if (isVerified) {
      setIsAgeVerified(true);
      setShowAgeModal(false);
      
      // Store verification in backend
      try {
        await axios.post(`${API}/age-verify`, {
          verified: true
        });
      } catch (error) {
        console.error('Age verification storage failed:', error);
      }
    } else {
      alert('You must be 18 or older to use this application.');
    }
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setSelectedImage(file);
    
    // Upload to backend
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await axios.post(`${API}/upload-image`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setSelectedImageBase64(response.data.base64);
    } catch (error) {
      console.error('Image upload failed:', error);
      alert('Failed to upload image. Please try again.');
    }
  };

  const handleMaskCreated = (areas) => {
    setMaskAreas(areas);
  };

  const createMask = async (areas) => {
    if (!areas.length) return null;
    
    try {
      const formData = new FormData();
      formData.append('image_base64', selectedImageBase64);
      formData.append('mask_data', JSON.stringify(areas));
      
      const response = await axios.post(`${API}/create-mask`, formData);
      return response.data.mask_base64;
    } catch (error) {
      console.error('Mask creation failed:', error);
      return null;
    }
  };

  const handleRemoveObject = async () => {
    if (!selectedImageBase64 || !maskAreas.length) {
      alert('Please select an image and mark areas to remove.');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const maskBase64 = await createMask(maskAreas);
      if (!maskBase64) {
        throw new Error('Failed to create mask');
      }
      
      const formData = new FormData();
      formData.append('image_base64', selectedImageBase64);
      formData.append('mask_base64', maskBase64);
      formData.append('prompt', prompt || 'remove the selected object');
      
      const response = await axios.post(`${API}/remove-object`, formData);
      setResultImage(response.data.result_image_base64);
      
      // Update history
      fetchEditHistory();
    } catch (error) {
      console.error('Object removal failed:', error);
      alert('Failed to remove object. Please check your API key and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddObject = async () => {
    if (!selectedImageBase64 || !prompt) {
      alert('Please select an image and enter a description of what to add.');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('image_base64', selectedImageBase64);
      formData.append('prompt', prompt);
      
      // If mask areas exist, include them
      if (maskAreas.length) {
        const maskBase64 = await createMask(maskAreas);
        if (maskBase64) {
          formData.append('mask_base64', maskBase64);
        }
      }
      
      const response = await axios.post(`${API}/add-object`, formData);
      setResultImage(response.data.result_image_base64);
      
      // Update history
      fetchEditHistory();
    } catch (error) {
      console.error('Object addition failed:', error);
      alert('Failed to add object. Please check your API key and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextGuidedEdit = async () => {
    if (!selectedImageBase64 || !prompt) {
      alert('Please select an image and enter editing instructions.');
      return;
    }
    
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('image_base64', selectedImageBase64);
      formData.append('prompt', prompt);
      
      const response = await axios.post(`${API}/text-guided-edit`, formData);
      setResultImage(response.data.result_image_base64);
      
      // Update history
      fetchEditHistory();
    } catch (error) {
      console.error('Text-guided edit failed:', error);
      alert('Failed to perform text-guided edit. Please check your API key and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const fetchEditHistory = async () => {
    try {
      const response = await axios.get(`${API}/edit-history`);
      setEditHistory(response.data.history);
    } catch (error) {
      console.error('Failed to fetch edit history:', error);
    }
  };

  useEffect(() => {
    if (isAgeVerified) {
      fetchEditHistory();
    }
  }, [isAgeVerified]);

  const downloadImage = () => {
    if (!resultImage) return;
    
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${resultImage}`;
    link.download = `edited-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isAgeVerified) {
    return (
      <div className="min-h-screen bg-gray-100">
        <AgeVerificationModal 
          isOpen={showAgeModal} 
          onVerify={handleAgeVerification} 
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🎨 AI Image Editor
          </h1>
          <p className="text-gray-600">
            Advanced AI-powered image editing - Remove objects, add elements, transform images
          </p>
        </header>

        <div className="max-w-6xl mx-auto">
          {/* Upload Section */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">📁 Upload Image</h2>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                ref={fileInputRef}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Choose Image
              </button>
              {selectedImage && (
                <span className="text-green-600 font-medium">
                  ✅ {selectedImage.name}
                </span>
              )}
            </div>
          </div>

          {selectedImageBase64 && (
            <>
              {/* Original Image Display */}
              <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">🖼️ Original Image</h2>
                <img
                  src={`data:image/jpeg;base64,${selectedImageBase64}`}
                  alt="Original"
                  className="max-w-full h-auto rounded-lg shadow-md"
                />
              </div>

              {/* Editing Tools */}
              <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">🛠️ Editing Tools</h2>
                
                {/* Tool Selection */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <button
                    onClick={() => {
                      setEditMode('remove');
                      setShowCanvas(true);
                      setPrompt('');
                    }}
                    className={`p-4 rounded-lg border-2 transition-colors ${
                      editMode === 'remove'
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-300 hover:border-red-300'
                    }`}
                  >
                    <div className="text-red-600 text-2xl mb-2">🗑️</div>
                    <h3 className="font-semibold">Remove Object</h3>
                    <p className="text-sm text-gray-600">
                      Select and remove unwanted objects
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      setEditMode('add');
                      setShowCanvas(false);
                      setPrompt('');
                    }}
                    className={`p-4 rounded-lg border-2 transition-colors ${
                      editMode === 'add'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-300 hover:border-green-300'
                    }`}
                  >
                    <div className="text-green-600 text-2xl mb-2">➕</div>
                    <h3 className="font-semibold">Add Object</h3>
                    <p className="text-sm text-gray-600">
                      Add new elements to your image
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      setEditMode('text-edit');
                      setShowCanvas(false);
                      setPrompt('');
                    }}
                    className={`p-4 rounded-lg border-2 transition-colors ${
                      editMode === 'text-edit'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-300'
                    }`}
                  >
                    <div className="text-blue-600 text-2xl mb-2">✨</div>
                    <h3 className="font-semibold">Text-Guided Edit</h3>
                    <p className="text-sm text-gray-600">
                      Transform image with instructions
                    </p>
                  </button>
                </div>

                {/* Drawing Canvas for Object Removal */}
                <DrawingCanvas
                  imageData={selectedImageBase64}
                  onMaskCreated={handleMaskCreated}
                  isVisible={showCanvas}
                />

                {/* Prompt Input */}
                {editMode && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {editMode === 'remove' && 'Additional Instructions (optional)'}
                      {editMode === 'add' && 'What to add (required)'}
                      {editMode === 'text-edit' && 'Editing Instructions (required)'}
                    </label>
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={
                        editMode === 'remove'
                          ? 'e.g., replace with grass background'
                          : editMode === 'add'
                          ? 'e.g., add a beautiful sunset in the background'
                          : 'e.g., make the sky more dramatic'
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}

                {/* Action Buttons */}
                {editMode && (
                  <div className="mt-6 flex gap-4">
                    {editMode === 'remove' && (
                      <button
                        onClick={handleRemoveObject}
                        disabled={isProcessing}
                        className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isProcessing ? '🔄 Processing...' : '🗑️ Remove Object'}
                      </button>
                    )}
                    
                    {editMode === 'add' && (
                      <button
                        onClick={handleAddObject}
                        disabled={isProcessing || !prompt}
                        className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isProcessing ? '🔄 Processing...' : '➕ Add Object'}
                      </button>
                    )}
                    
                    {editMode === 'text-edit' && (
                      <button
                        onClick={handleTextGuidedEdit}
                        disabled={isProcessing || !prompt}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isProcessing ? '🔄 Processing...' : '✨ Apply Edit'}
                      </button>
                    )}
                    
                    <button
                      onClick={() => {
                        setEditMode('');
                        setShowCanvas(false);
                        setPrompt('');
                        setMaskAreas([]);
                      }}
                      className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Result Image */}
              {resultImage && (
                <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">🎉 Edited Result</h2>
                    <button
                      onClick={downloadImage}
                      className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      📥 Download
                    </button>
                  </div>
                  <img
                    src={`data:image/png;base64,${resultImage}`}
                    alt="Edited Result"
                    className="max-w-full h-auto rounded-lg shadow-md"
                  />
                </div>
              )}
            </>
          )}

          {/* Edit History */}
          {editHistory.length > 0 && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">📚 Recent Edits</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {editHistory.slice(0, 6).map((edit, index) => (
                  <div key={edit.id || index} className="border rounded-lg p-3">
                    <div className="text-sm text-gray-600 mb-2">
                      {edit.operation_type?.replace('_', ' ').toUpperCase()}
                    </div>
                    <div className="text-sm font-medium text-gray-800 mb-2">
                      {edit.prompt}
                    </div>
                    <div className="text-xs text-gray-500">
                      {edit.processing_time?.toFixed(1)}s processing time
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* API Key Notice */}
        <div className="fixed bottom-4 right-4 bg-yellow-100 border border-yellow-400 rounded-lg p-3 max-w-sm">
          <div className="text-sm text-yellow-800">
            <strong>⚠️ Setup Required:</strong> Add your REPLICATE_API_KEY to backend/.env to enable AI editing features.
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;