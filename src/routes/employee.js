// src/routes/employees.js

const express = require('express');
const router = express.Router();
// Assuming you have an employeeController for the logic
const { getEmployees } = require('../controllers/employeeController'); 

// Define the single, correct endpoint to get/view employees
router.get('/employees', getEmployees); 

module.exports = router;