import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css"; // Bootstrap Icons
import "./App.css"; // Custom CSS for additional styling
import { useTheme } from './contexts/ThemeContext';

const AIDocumentProcessor = () => {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePath, setFilePath] = useState("");
  const [text, setText] = useState("");
  const [forms, setForms] = useState([]); // Initialize as an array
  const [tables, setTables] = useState([]);
  const [activeTab, setActiveTab] = useState("text");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false); // For upload spinner
  const [isExtracting, setIsExtracting] = useState(false); // For extraction spinner
  const [searchQuery, setSearchQuery] = useState(""); // For search functionality
  const [showExportDropdown, setShowExportDropdown] = useState(false); // For export dropdown
  const fileInputRef = useRef(null); // Ref for file input
  const [currentPage, setCurrentPage] = useState(1); // Track current page
  const [tablesPerPage] = useState(1); // Number of tables per page
  const indexOfLastTable = currentPage * tablesPerPage;
  const indexOfFirstTable = indexOfLastTable - tablesPerPage;
  const currentTables = tables.slice(indexOfFirstTable, indexOfLastTable);
  const { darkMode, toggleDarkMode } = useTheme();

  useEffect(() => {
    const isLoggedIn = localStorage.getItem("isLoggedIn");
    if (!isLoggedIn) {
      navigate("/");
    }
  }, [navigate]);

  // Logout function
  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn"); // Clear login state
    navigate("/"); // Redirect to login page
  };

 // Add this useEffect hook to your component
useEffect(() => {
  document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  document.body.style.backgroundColor = darkMode ? '#121212' : '#f1f1f1';
}, [darkMode]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      handleUpload(file); // Automatically trigger upload after file selection
    }
  };

  const handleUpload = async (file) => {
    if (!file) {
      setError("Please select a file first!");
      return;
    }

    setIsUploading(true); // Show spinner during upload
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post("http://localhost:8000/upload/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });
      setFilePath(response.data.path);
      setError("");
      alert("File uploaded successfully!");
    } catch (error) {
      setError("Upload failed. Unsupported file type. Please upload a PDF, TXT, PNG, or JPG file.");
    } finally {
      setIsUploading(false); // Hide spinner after upload
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset file input
      }
    }
  };

  const extractText = async () => {
    if (!filePath) {
      setError("Upload a file first!");
      return;
    }

    setIsExtracting(true); // Show spinner during extraction
    try {
      const response = await axios.post("http://localhost:8000/extract_text/", {
        file_path: filePath,
      });

      console.log("Extracted Data:", response.data);
      setText(response.data.text || "No text extracted");
      setForms(response.data.forms || {}); // Update forms state
      setTables(response.data.tables || []);
      setError("");
    } catch (error) {
      setError(error.response?.data?.detail || "Text extraction failed. Please try again.");
    } finally {
      setIsExtracting(false); // Hide spinner after extraction
    }
  };

  const exportData = async (format) => {
    try {
      const response = await axios.get(`http://localhost:8000/export_data/?file_path=${filePath}&format=${format}`, {
        responseType: "blob", // Ensure the response is treated as a binary file
      });

      // Create a Blob from the response data
      const blob = new Blob([response.data], { type: response.headers["content-type"] });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Set the filename based on the format
      if (format === "json") {
        link.download = "data.json";
      } else if (format === "csv") {
        link.download = "data.csv";
      } else if (format === "txt") {
        link.download = "data.txt";
      }

      // Trigger the download
      link.click();

      // Clean up
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error.response?.data || error.message);
    }
  };

  const filteredText = text
    .split("\n")
    .filter((line) => line.toLowerCase().includes(searchQuery.toLowerCase()))
    .join("\n");

  const toggleExportDropdown = () => {
    setShowExportDropdown(!showExportDropdown);
  };

  const [visibleTables, setVisibleTables] = useState(tables.map(() => true));

  const toggleTable = (index) => {
    const updatedVisibility = [...visibleTables];
    updatedVisibility[index] = !updatedVisibility[index];
    setVisibleTables(updatedVisibility);
  };

  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  const nextPage = () => {
    if (currentPage < Math.ceil(tables.length / tablesPerPage)) {
      setCurrentPage(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // Generate page numbers
  const pageNumbers = [];
  for (let i = 1; i <= Math.ceil(tables.length / tablesPerPage); i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="main-div container-fluid mt-4" data-theme={darkMode ? "dark" : "light"}>
      <div className="head-div d-flex justify-content-between align-items-center border p-3">
        <h2 className="mb-3 fw-bold">AI-Document Processor</h2>
        <div className="d-flex align-items-center">
          {/* Dark Mode Toggle Button */}
          <button
            className="btn-down btn-secondary me-2"
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            <i className={`bi ${darkMode ? "bi-sun" : "bi-moon"}`}></i>
          </button>
          {/* Upload Button */}
          <button
            className="btn-down btn-primary me-2"
            onClick={() => fileInputRef.current.click()} // Trigger file input
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Uploading...
              </>
            ) : (
              <>
                <i className="bi bi-upload me-2"></i>Upload
              </>
            )}
          </button>
          {/* Hidden File Input */}
          <input
            type="file"
            className="d-none"
            onChange={handleFileChange}
            ref={fileInputRef} // Attach ref to file input
          />
          {/* Download Result Dropdown */}
          <div className="dropdown me-2">
            <button
              className="btn-down btn-secondary"
              onClick={toggleExportDropdown}
              aria-expanded={showExportDropdown}
            >
              <i className="bi bi-download me-2"></i>Download Result
            </button>
            <ul className={`dropdown-menu ${showExportDropdown ? "show" : ""}`}>
              <li>
                <button className="dropdown-item" onClick={() => exportData("json")}>
                  <i className="bi bi-filetype-json me-2"></i>JSON
                </button>
              </li>
              <li>
                <button className="dropdown-item" onClick={() => exportData("csv")}>
                  <i className="bi bi-filetype-csv me-2"></i>CSV
                </button>
              </li>
              <li>
                <button className="dropdown-item" onClick={() => exportData("txt")}>
                  <i className="bi bi-filetype-txt me-2"></i>TXT
                </button>
              </li>
            </ul>
          </div>
          {/* Logout Button */}
          <button
            className="btn-down btn-danger"
            onClick={handleLogout}
          >
            <i className="bi bi-box-arrow-left me-2"></i>Logout
          </button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="row">
        <div className="col-md-6">
          <div className="card shadow">
            <div className="d-flex justify-content-between align-items-center card-header">
              <p className="text-truncate mb-0">Uploaded File: {selectedFile?.name}</p>
              <button className="btn-down btn-success" onClick={extractText} disabled={isExtracting || !filePath}>
                {isExtracting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Extracting...
                  </>
                ) : (
                  <>
                    <i className="bi"></i>Extract Text
                  </>
                )}
              </button>
            </div>
            <div className="card-body text-center">
              <div className="mt-3">
                {filePath && selectedFile?.type.startsWith("image/") ? (
                  <img src={`http://localhost:8000${filePath}`} alt="Preview" className="img-fluid border rounded" />
                ) : filePath ? (
                  <iframe src={`http://localhost:8000${filePath}`} title="File Preview" width="100%" height="430px" className="border rounded" />
                ) : (
                  <p>No preview available</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card shadow">
            <div className="card-header">
              <ul className="nav nav-tabs">
                <li className="nav-item">
                  <button className={`nav-link ${activeTab === "text" ? "active" : ""}`} onClick={() => setActiveTab("text")}>
                    Plain Text
                  </button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link ${activeTab === "forms" ? "active" : ""}`} onClick={() => setActiveTab("forms")}>
                    Key Value Pair
                  </button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link ${activeTab === "tables" ? "active" : ""}`} onClick={() => setActiveTab("tables")}>
                    Tables
                  </button>
                </li>
              </ul>
            </div>
            <div className="card-body">
              {/* <div className="mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search extracted text..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div> */}

              {activeTab === "text" && (
                <div className="mt-3 scrollable-section">
                  {text.split("\n").map((line, index) => (
                    <div key={index} className="text-line">
                      {line}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "forms" && (
                <div className="mt-3 scrollable-section">
                  {forms.length > 0 ? (
                    <table className="key-value-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forms.map((pair, index) => (
                          <tr key={index}>
                            <td>{pair.key}</td>
                            <td>{pair.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>No key-value pairs extracted</p>
                  )}
                </div>
              )}

              {activeTab === "tables" && (
                <div className="mt-3 scrollable-section">
                  {tables.length > 0 ? (
                    <>
                      {/* Inline Pagination Controls */}
                      <div className="d-flex align-items-center mb-3">
                        <h5 className="mb-0">{tables.length} tables found:</h5>
                        <div className="d-flex align-items-center">
                          <button
                            className="minimal-btn previous-next" // Add class for larger size
                            onClick={prevPage}
                            disabled={currentPage === 1}
                          >
                            &lt; {/* Previous button */}
                          </button>
                          {pageNumbers.map((number) => (
                            <button
                              key={number}
                              className={`minimal-btn ${
                                currentPage === number ? "active" : ""
                              }`}
                              onClick={() => paginate(number)}
                            >
                              {number}
                            </button>
                          ))}
                          <button
                            className="minimal-btn previous-next" // Add class for larger size
                            onClick={nextPage}
                            disabled={currentPage === pageNumbers.length}
                          >
                            &gt; {/* Next button */}
                          </button>
                        </div>
                      </div>

                      {/* Display Current Table */}
                      {currentTables.map((table, idx) => (
                        <div key={idx} className="mb-4">
                          <h6 className="table-header">Table {(currentPage - 1) * tablesPerPage + idx + 1}</h6>
                          <table className="table-bordered">
                            <thead>
                              <tr>
                                {table.headers.map((header, headerIndex) => (
                                  <th key={headerIndex}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((cell, cellIndex) => (
                                    <td key={cellIndex}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p>No tables extracted</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIDocumentProcessor;