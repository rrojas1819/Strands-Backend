const request = require('supertest');
const app = require('../src/app');
const connection = require('../src/config/databaseConnection');
const notificationsController = require('../src/controllers/notificationsController');
const { ROLE_CASES, baseSignupPayload, insertUserWithCredentials } = require('./helpers/authTestUtils');


//Admin Features & Data Visualization unit tests

