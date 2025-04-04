from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import shutil
from pathlib import Path
from pydantic import BaseModel
from typing import List, Dict
import traceback
from pymongo import MongoClient
import uuid
import logging
from google.cloud import documentai_v1 as documentai
import os
import json
import base64
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import RedirectResponse
import csv
import io

# Initialize FastAPI app
app = FastAPI()

# Add basic authentication
security = HTTPBasic()

# Hardcoded credentials (for demo purposes)
VALID_USERNAME = "demo@gmail.com"
VALID_PASSWORD = "Demo@123"

# Login endpoint
@app.post("/login/")
async def login(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != VALID_USERNAME or credentials.password != VALID_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"message": "Login successful"}

# Protected endpoint (AI-Document Processor)
@app.get("/ai-document-processor/")
async def ai_document_processor(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != VALID_USERNAME or credentials.password != VALID_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"message": "Welcome to AI-Document Processor"}

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Connect to MongoDB
try:
    client = MongoClient("mongodb://localhost:27017/")
    db = client["document_processing"]
    collection = db["extracted_data"]
    logger.info("Connected to MongoDB successfully!")
except Exception as e:
    logger.error(f"Error connecting to MongoDB: {e}")
    raise

# Serve static files from "uploads" directory
from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Allowed file extensions
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "txt"}

# Define Pydantic model for request validation
class ExtractTextRequest(BaseModel):
    file_path: str

# Initialize Google Document AI client
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = ""

# Google Document AI processor details
PROJECT_ID = ""
LOCATION = "us"  # e.g., "us"
FORM_PARSER_PROCESSOR_ID = ""  # Form Parser processor ID
DOCUMENT_OCR_PROCESSOR_ID = ""  # Document OCR processor ID

# Extract text, forms, and tables using Google Document AI
def extract_with_documentai(file_path: str):
    try:
        with open(file_path, "rb") as file:
            content = file.read()

        # Determine mime_type based on file extension
        file_ext = Path(file_path).suffix.lower()
        if file_ext == ".pdf":
            mime_type = "application/pdf"
        elif file_ext == ".png":
            mime_type = "image/png"
        elif file_ext in [".jpg", ".jpeg"]:
            mime_type = "image/jpeg"
        elif file_ext == ".tiff":
            mime_type = "image/tiff"
        elif file_ext == ".bmp":
            mime_type = "image/bmp"
        elif file_ext == ".gif":
            mime_type = "image/gif"
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type for Document AI")

        # Initialize Google Document AI client
        client = documentai.DocumentProcessorServiceClient()

        # Prepare request payload
        raw_document = documentai.RawDocument(
            content=content,
            mime_type=mime_type,  # Set mime_type dynamically
        )

        # Use OCR processor for images, Form Parser for PDFs
        processor_id = (
            DOCUMENT_OCR_PROCESSOR_ID if mime_type.startswith("image") else FORM_PARSER_PROCESSOR_ID
        )

        request = documentai.ProcessRequest(
            name=f"projects/{PROJECT_ID}/locations/{LOCATION}/processors/{processor_id}",
            raw_document=raw_document,
        )

        response = client.process_document(request=request)
        document = response.document

        # Extract plain text
        text = document.text

        # Extract Forms (Key-Value Pairs)
        forms = []  # Use a list to maintain order
        for page in document.pages:
            for field in page.form_fields:
                key_text = ""
                value_text = ""

                if field.field_name.text_anchor:
                    key_text = document.text[
                        field.field_name.text_anchor.text_segments[0].start_index:
                        field.field_name.text_anchor.text_segments[0].end_index
                    ]

                if field.field_value.text_anchor:
                    value_text = document.text[
                        field.field_value.text_anchor.text_segments[0].start_index:
                        field.field_value.text_anchor.text_segments[0].end_index
                    ]

                if key_text and value_text:
                    forms.append({"key": key_text.strip(), "value": value_text.strip()})  # Store as key-value pairs in a list

        # Extract Tables
        tables = []
        for page in document.pages:
            for table in page.tables:
                table_data = {
                    "headers": [],
                    "rows": []
                }

                # Extract header row
                if table.header_rows:
                    headers = []
                    for cell in table.header_rows[0].cells:
                        if cell.layout.text_anchor:
                            headers.append(
                                document.text[
                                    cell.layout.text_anchor.text_segments[0].start_index:
                                    cell.layout.text_anchor.text_segments[0].end_index
                                ].strip()
                            )
                    table_data["headers"] = headers

                # Extract table body rows
                for row in table.body_rows:
                    row_data = []
                    for cell in row.cells:
                        if cell.layout.text_anchor:
                            row_data.append(
                                document.text[
                                    cell.layout.text_anchor.text_segments[0].start_index:
                                    cell.layout.text_anchor.text_segments[0].end_index
                                ].strip()
                            )
                    table_data["rows"].append(row_data)

                tables.append(table_data)

        return text, forms, tables

    except Exception as e:
        logger.error(f"Error extracting data with Google Document AI: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
# Export data endpoint
@app.get("/export_data/")
async def export_data(file_path: str, format: str):
    try:
        file_path = file_path.lstrip("/")
        file_path = UPLOAD_DIR / Path(file_path).name

        if not file_path.exists():
            raise HTTPException(status_code=400, detail=f"File not found: {file_path}")

        # Load the extracted data from MongoDB
        document_data = collection.find_one({"file_path": str(file_path)})
        if not document_data:
            raise HTTPException(status_code=404, detail="No extracted data found for this file")

        text = document_data.get("extracted_text", "")
        forms = document_data.get("forms", [])
        tables = document_data.get("tables", [])

        if format == "json":
            # Return JSON data
            return JSONResponse(content={
                "text": text,
                "forms": forms,
                "tables": tables
            })

        elif format == "csv":
            # Convert data to CSV
            output = io.StringIO()
            writer = csv.writer(output)

            # Write text
            writer.writerow(["Text"])
            writer.writerow([text])

            # Write forms
            writer.writerow([])
            writer.writerow(["Forms"])
            writer.writerow(["Key", "Value"])
            for form in forms:
                writer.writerow([form.get("key", ""), form.get("value", "")])

            # Write tables
            writer.writerow([])
            writer.writerow(["Tables"])
            for table in tables:
                writer.writerow([f"Table {tables.index(table) + 1}"])
                writer.writerow(table.get("headers", []))
                for row in table.get("rows", []):
                    writer.writerow(row)
                writer.writerow([])

            output.seek(0)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=data.csv"}
            )

        elif format == "txt":
            # Convert data to TXT
            output = io.StringIO()

            # Write text
            output.write("Text:\n")
            output.write(text)
            output.write("\n\n")

            # Write forms
            output.write("Forms:\n")
            for form in forms:
                output.write(f"{form.get('key', '')}: {form.get('value', '')}\n")
            output.write("\n")

            # Write tables
            output.write("Tables:\n")
            for table in tables:
                output.write(f"Table {tables.index(table) + 1}:\n")
                output.write(" | ".join(table.get("headers", [])))
                output.write("\n")
                for row in table.get("rows", []):
                    output.write(" | ".join(row))
                    output.write("\n")
                output.write("\n")

            output.seek(0)
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/plain",
                headers={"Content-Disposition": "attachment; filename=data.txt"}
            )

        else:
            raise HTTPException(status_code=400, detail="Unsupported export format")

    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail="Error exporting data")

# Upload file endpoint
@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    try:
        # Validate file type
        file_ext = file.filename.split(".")[-1].lower()
        if file_ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a PDF, TXT, PNG, or JPG file.")

        # Generate a unique file name
        unique_filename = f"{uuid.uuid4()}_{file.filename}"
        file_path = UPLOAD_DIR / unique_filename

        # Save the uploaded file
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        logger.info(f"File uploaded successfully: {file_path}")
        return {"filename": unique_filename, "path": f"/uploads/{unique_filename}"}
    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        raise HTTPException(status_code=500, detail=f"Error uploading file: {e}")

# Extract text endpoint
@app.post("/extract_text/")
async def extract_text(request: ExtractTextRequest):
    try:
        file_path = request.file_path.lstrip("/")
        file_path = UPLOAD_DIR / Path(file_path).name

        if not file_path.exists():
            raise HTTPException(status_code=400, detail=f"File not found: {file_path}")

        file_ext = file_path.suffix.lower().strip(".")
        text, forms, tables = "", [], []

        # Process PDFs and images using Google Document AI
        if file_ext in ["pdf", "png", "jpg", "jpeg"]:
            logger.info(f"Processing file with Google Document AI: {file_path}")
            text, forms, tables = extract_with_documentai(str(file_path))
        elif file_ext == "txt":
            logger.info(f"Processing text file: {file_path}")
            try:
                with open(str(file_path), "r", encoding="utf-8") as f:
                    text = f.read()
            except Exception as e:
                logger.error(f"Error reading text file: {e}")
                raise HTTPException(status_code=500, detail=f"Error reading text file: {e}")
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type")

        if not text.strip():
            raise HTTPException(status_code=400, detail="No text extracted")

        # Save extracted data to separate files
        try:
            # Save plain text to a .txt file
            text_file_path = file_path.with_suffix(".txt")
            with open(text_file_path, "w", encoding="utf-8") as text_file:
                text_file.write(text)
            logger.info(f"Plain text saved to: {text_file_path}")

            # Save key-value pairs (forms) to a .json file
            forms_file_path = file_path.with_suffix(".forms.json")
            with open(forms_file_path, "w", encoding="utf-8") as forms_file:
                json.dump(forms, forms_file, indent=4)
            logger.info(f"Key-value pairs saved to: {forms_file_path}")

            # Save tables to a .json file
            tables_file_path = file_path.with_suffix(".tables.json")
            with open(tables_file_path, "w", encoding="utf-8") as tables_file:
                json.dump(tables, tables_file, indent=4)
            logger.info(f"Tables saved to: {tables_file_path}")
        except Exception as e:
            logger.error(f"Error saving extracted data to files: {e}")
            raise HTTPException(status_code=500, detail="Error saving extracted data to files")

        # Save data to MongoDB
        try:
            document_data = {
                "file_path": str(file_path),
                "extracted_text": text,
                "forms": forms,
                "tables": tables
            }
            collection.insert_one(document_data)
            logger.info("Data saved to MongoDB successfully!")
        except Exception as e:
            logger.error(f"Error saving data to MongoDB: {e}")
            raise HTTPException(status_code=500, detail="Error saving data to MongoDB")

        return {
            "text": text,
            "forms": forms,
            "tables": tables,
            "message": "Data saved to MongoDB and files"
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        error_message = f"Error processing {request.file_path}: {str(e)}"
        logger.error(error_message)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_message)

# Run the FastAPI app
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)