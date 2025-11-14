const { uploadUniqueFile } = require('../utils/s3.js');

exports.fileUpload = async (req, res) => {
	try {
	  if (!req.file) {
		console.log("No file found in request");
		return res.status(400).json({ 
			error: "No file uploaded." 
		});
	  }
  
	  const { buffer, mimetype } = req.file;

	  const result = await uploadUniqueFile(buffer, mimetype);
  
	  res.status(200).json(result);
	} catch (error) {
		console.error("Upload Error:", error);
		res.status(500).json({ 
			error: "Failed to upload file." 
		});
	}
};