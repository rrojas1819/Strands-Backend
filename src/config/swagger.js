const swaggerJsdoc = require('swagger-jsdoc');

const options = {
	definition: {
		openapi: '3.0.0',
		info: {
			title: 'Strands Backend API',
			version: '1.0.0',
			description: 'API documentation for Strands - A salon management web application that brings together salon owners, employees, customers, and admins.',
			contact: {
				name: 'Strands API Support'
			}
		},
		servers: [
			{
				url: `http://localhost:${process.env.PORT || 3000}`,
				description: 'Development server'
			}
		],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
					description: 'Enter JWT token'
				}
			},
			schemas: {
				Error: {
					type: 'object',
					properties: {
						error: {
							type: 'string',
							description: 'Error message'
						},
						message: {
							type: 'string',
							description: 'Error message'
						}
					}
				},
				Success: {
					type: 'object',
					properties: {
						message: {
							type: 'string',
							description: 'Success message'
						}
					}
				}
			}
		},
		security: [
			{
				bearerAuth: []
			}
		]
	},
	apis: [
		'./src/routes/*.js',
		'./src/controllers/*.js',
		'./src/server.js'
	]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

