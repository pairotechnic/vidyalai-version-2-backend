const express = require('express') // for creating the server
const multer = require('multer') // for handling file uploads
const path = require('path') // for file path manipulation
const cors = require('cors') // for enabling Cross-Origin Resource Sharing
const { PDFDocument } = require('pdf-lib'); // for PDF manipulation
const fs = require('fs'); // for file system operations
const dotenv = require('dotenv') // for using .env file
const AWS = require('aws-sdk')
const { v4 : uuidv4 } = require('uuid')

dotenv.config() // loads contents of .env into process.env
// Only required during development, because in production we directly enter the environment variables in VERCEL 

// Configure AWS SDK
AWS.config.update({
  accessKeyId : process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey : process.env.AWS_SECRET_ACCESS_KEY,
  region : process.env.AWS_REGION
})

const s3 = new AWS.S3()

const app = express() // Express application is created

app.use(cors()) // used to allow cross-origin requests
app.use(express.json()); // used to parse incoming JSON payloads

// Use multer.memoryStorage for storing files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
     if (file.mimetype === 'application/pdf') {
       cb(null, true);
     } else {
       cb(new Error('Only PDFs are allowed!'), false);
     }
  }
 });

// Backend testing route
app.get('/superman', (req, res) => {
  res.json({ msg : 'This test endpoint /superman is workin'})
})

// File Upload route
app.post('/api/upload', upload.single('pdf'), async (req, res) => { // accepts a single file upload, with the field name 'pdf'

  try{
    const file = req.file
    // const fileName = `${uuidv4()}-${file.originalname}`; // Generate a unique file name
    const fileName = `${file.originalname}-${uuidv4()}`; // Generate a unique file name

    const params = {
      Bucket : 'pairotechnic-aws-bucket',
      // Key : `uploads/${file.originalname}`, // File will be saved in the 'uploads' folder in S3
      Key: `uploads/${fileName}`, // File will be saved in the 'uploads' folder in S3
      Body: file.buffer,
      ACL : 'public-read' // Make the file publicly accessible
    }

    const response = await s3.upload(params).promise()
    const filePath = response.Location; // This is the URL of the uploaded file in S3

    console.log("filePath : " , filePath)

    res.status(200).json({ message : 'File Uploaded Successfully', filePath})

  } catch (error) {
    console.error('Error uploading file to S3 : ', error)
    res.status(500).json({ message : 'File Upload Failed', error : error.message})
  }

})

// Route for generating new pdf from extracted pages
app.post('/api/extract-pages', async (req, res) => {

  try {

    const { originalPdfPath, selectedPages } = req.body;

    // Sort selectedPages in ascending order
    selectedPages.sort((a, b) => a - b);

    // Fetch the PDF from S3 into memory
    const params = {
      Bucket: 'pairotechnic-aws-bucket',
      Key: originalPdfPath,
    };
    const data = await s3.getObject(params).promise();
    const originalPdfBytes = data.Body; // This is a Buffer

    // Load the PDF from the Buffer
    const originalPdfDoc = await PDFDocument.load(originalPdfBytes);
    const generatedPdfDoc = await PDFDocument.create()

    // Extract the original filename without the path, and adding datetime to make it unique

    console.log("originalPdfPath : " , originalPdfPath)
    const originalFilename = path.basename(originalPdfPath);
    console.log("originalFilename : " , originalFilename)
    const originalName = originalFilename.split('.')[0];
    console.log("originalName : " , originalName)
    const generatedPdfName = `${originalName}-${Date.now()}.pdf`;
    console.log("generatedPdfName : " , generatedPdfName)

    // Extract the selected pages
    await Promise.all(selectedPages.map(async (pageNumber) => {
      const [copiedPage] = await generatedPdfDoc.copyPages(originalPdfDoc, [pageNumber - 1]);
      generatedPdfDoc.addPage(copiedPage)
    }));

    // Save the generated PDF to a Buffer
    const generatedPdfBytes = await generatedPdfDoc.save();

    // Upload the generated PDF to S3
    const uploadParams = {
      Bucket: 'pairotechnic-aws-bucket',
      Key: `generated/${generatedPdfName}`,
      Body: generatedPdfBytes,
      ACL: 'public-read',
    };
    const response = await s3.upload(uploadParams).promise();
    const filePath = response.Location;

    res.status(200).json({ message: 'New PDF created successfully', filePath });

  } catch (error) {
    console.error('Error creating new PDF:', error);
    res.status(500).json({ message: 'Error creating new PDF', error: error.message });
  }
});

app.listen(process.env.port, () => {
  console.log(`Server running at http://localhost:${process.env.port}`)
})