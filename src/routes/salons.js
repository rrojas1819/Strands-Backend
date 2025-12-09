const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/salons/check:
 *   get:
 *     summary: Check if owner has a salon
 *     description: Check if the authenticated owner already has a registered salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasSalon:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   nullable: true
 *                   enum: [PENDING, APPROVED, REJECTED]
 *       401:
 *         description: No user found
 *       500:
 *         description: Internal server error
 */
router.get('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);

/**
 * @swagger
 * /api/salons/create:
 *   post:
 *     summary: Create a new salon
 *     description: Owner registers a new salon (pending admin verification)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *               - category
 *               - phone
 *               - email
 *               - address
 *               - city
 *               - state
 *               - postal_code
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [NAIL SALON, HAIR SALON, EYELASH STUDIO, SPA & WELLNESS, BARBERSHOP, FULL SERVICE BEAUTY]
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               postal_code:
 *                 type: string
 *               country:
 *                 type: string
 *                 default: USA
 *     responses:
 *       201:
 *         description: Salon registered (pending verification)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Salon registered (pending verification)
 *                 data:
 *                   type: object
 *                   description: Full salon record
 *       400:
 *         description: Missing or invalid fields
 *       403:
 *         description: Invalid role
 *       409:
 *         description: Owner already has a salon
 *       500:
 *         description: Internal server error
 */
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);

/**
 * @swagger
 * /api/salons/approve:
 *   patch:
 *     summary: Approve or reject a salon
 *     description: Admin approves or rejects a salon registration
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - salon_id
 *               - status
 *             properties:
 *               salon_id:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *     responses:
 *       200:
 *         description: Salon status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Salon 1 has been approved.
 *       400:
 *         description: Invalid salon_id or status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - ADMIN role required
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.patch('/approve', authenticateToken, roleAuthorization(['ADMIN']), salonController.approveSalon);

/**
 * @swagger
 * /api/salons/browse:
 *   get:
 *     summary: Browse salons
 *     description: Get paginated list of salons with filtering and sorting options
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, PENDING, APPROVED, REJECTED]
 *           default: all
 *         description: Filter by status (admin only)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [recent, name_asc, name_desc, rating]
 *           default: recent
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Salons list retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       salon_id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       category:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       email:
 *                         type: string
 *                       address:
 *                         type: string
 *                       city:
 *                         type: string
 *                       state:
 *                         type: string
 *                       postal_code:
 *                         type: string
 *                       country:
 *                         type: string
 *                       status:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *                       weekly_hours:
 *                         type: object
 *                         description: Salon operating hours by weekday
 *                       photo_url:
 *                         type: string
 *                         nullable: true
 *                       rating:
 *                         type: number
 *                         nullable: true
 *                         description: Average rating (customer view only)
 *                       total_reviews:
 *                         type: integer
 *                         description: Total reviews (customer view only)
 *                       owner:
 *                         type: object
 *                         description: Owner info (admin view only)
 *                         properties:
 *                           user_id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phone:
 *                             type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         description: Invalid limit or offset
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/browse', authenticateToken, roleAuthorization(['ADMIN', 'CUSTOMER']), salonController.browseSalons);

/**
 * @swagger
 * /api/salons/addEmployee:
 *   post:
 *     summary: Add an employee to salon
 *     description: Owner adds an employee to their salon by email
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - title
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               title:
 *                 type: string
 *                 description: Employee's job title
 *     responses:
 *       200:
 *         description: Employee added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Employee employee@example.com has been added to salon.
 *       400:
 *         description: Missing required fields or invalid email
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       409:
 *         description: Employee does not exist or already assigned
 *       500:
 *         description: Internal server error
 */
router.post('/addEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.addEmployee);

/**
 * @swagger
 * /api/salons/removeEmployee:
 *   delete:
 *     summary: Remove an employee from salon
 *     description: Owner removes an employee from their salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Employee removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Employee employee@example.com has been removed from salon.
 *       400:
 *         description: Missing required fields or invalid email
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.delete('/removeEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.removeEmployee);

/**
 * @swagger
 * /api/salons/viewEmployees:
 *   post:
 *     summary: View salon employees
 *     description: Owner views paginated list of salon employees
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - limit
 *               - offset
 *             properties:
 *               limit:
 *                 type: integer
 *               offset:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Employees list retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       employee_id:
 *                         type: integer
 *                       user_id:
 *                         type: integer
 *                       title:
 *                         type: string
 *                       active:
 *                         type: boolean
 *                       full_name:
 *                         type: string
 *                       email:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       profile_picture_url:
 *                         type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     total_employees:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     has_next_page:
 *                       type: boolean
 *                     has_prev_page:
 *                       type: boolean
 *       400:
 *         description: Invalid fields
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/viewEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.viewEmployees);

/**
 * @swagger
 * /api/salons/configureLoyaltyProgram:
 *   post:
 *     summary: Configure salon loyalty program
 *     description: Owner creates a loyalty program for their salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - target_visits
 *               - discount_percentage
 *             properties:
 *               target_visits:
 *                 type: integer
 *                 description: Number of visits required for reward
 *               discount_percentage:
 *                 type: number
 *                 description: Discount percentage for the reward
 *               note:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Loyalty program configured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Salon has been configured with a loyalty program.
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.post('/configureLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.configureLoyaltyProgram);

/**
 * @swagger
 * /api/salons/updateLoyaltyProgram:
 *   patch:
 *     summary: Update salon loyalty program
 *     description: Owner updates their salon's loyalty program
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - target_visits
 *               - discount_percentage
 *             properties:
 *               target_visits:
 *                 type: integer
 *               discount_percentage:
 *                 type: number
 *               note:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Loyalty program updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Salon's loyalty program has been updated.
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No loyalty program found
 *       500:
 *         description: Internal server error
 */
router.patch('/updateLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.updateLoyaltyProgram);

/**
 * @swagger
 * /api/salons/getLoyaltyProgram:
 *   get:
 *     summary: Get salon loyalty program
 *     description: Owner gets their salon's loyalty program details
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 programData:
 *                   type: object
 *                   properties:
 *                     target_visits:
 *                       type: integer
 *                     discount_percentage:
 *                       type: number
 *                     note:
 *                       type: string
 *                     active:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No loyalty program found
 *       500:
 *         description: Internal server error
 */
router.get('/getLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.getLoyaltyProgram);

/**
 * @swagger
 * /api/salons/getHours:
 *   get:
 *     summary: Get salon operating hours
 *     description: Owner gets their salon's weekly operating hours
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon hours retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     weekly_hours:
 *                       type: object
 *                       description: Hours by weekday (SUNDAY through SATURDAY)
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           is_open:
 *                             type: boolean
 *                           start_time:
 *                             type: string
 *                             nullable: true
 *                           end_time:
 *                             type: string
 *                             nullable: true
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/getHours', authenticateToken, roleAuthorization(['OWNER']), salonController.getSalonHours);

/**
 * @swagger
 * /api/salons/setHours:
 *   post:
 *     summary: Set salon operating hours
 *     description: Owner sets their salon's weekly operating hours
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - weekly_hours
 *             properties:
 *               weekly_hours:
 *                 type: object
 *                 description: Hours by weekday name
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     is_open:
 *                       type: boolean
 *                     start_time:
 *                       type: string
 *                       format: time
 *                     end_time:
 *                       type: string
 *                       format: time
 *     responses:
 *       200:
 *         description: Salon hours set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       weekday:
 *                         type: string
 *                       action:
 *                         type: string
 *                         enum: [created, updated, removed]
 *                       start_time:
 *                         type: string
 *                       end_time:
 *                         type: string
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Missing weekly_hours object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/setHours', authenticateToken, roleAuthorization(['OWNER']), salonController.setSalonHours);

/**
 * @swagger
 * /api/salons/getEmployees:
 *   get:
 *     summary: Get salon employees
 *     description: Owner gets list of their salon employees
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employees list retrieved
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/getEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployees);

/**
 * @swagger
 * /api/salons/setEmployeeAvailability/{employeeId}:
 *   post:
 *     summary: Set employee availability
 *     description: Owner sets weekly availability for a specific employee
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - weekly_availability
 *             properties:
 *               weekly_availability:
 *                 type: object
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     is_available:
 *                       type: boolean
 *                     start_time:
 *                       type: string
 *                       format: time
 *                     end_time:
 *                       type: string
 *                       format: time
 *     responses:
 *       200:
 *         description: Employee availability set
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.post('/setEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.setEmployeeAvailability);

/**
 * @swagger
 * /api/salons/getEmployeeAvailability/{employeeId}:
 *   get:
 *     summary: Get employee availability
 *     description: Owner gets weekly availability for a specific employee
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Employee availability retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/getEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployeeAvailability);

/**
 * @swagger
 * /api/salons/stylist/createService:
 *   post:
 *     summary: Stylist creates a service
 *     description: Employee creates a new service they offer
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - duration_minutes
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               duration_minutes:
 *                 type: integer
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Service created
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Employee not active
 *       409:
 *         description: Service with similar name already exists
 *       500:
 *         description: Internal server error
 */
router.post('/stylist/createService', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.createAndAddServiceToStylist);

/**
 * @swagger
 * /api/salons/stylist/updateService/{service_id}:
 *   patch:
 *     summary: Stylist updates a service
 *     description: Employee updates a service they offer
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: service_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               duration_minutes:
 *                 type: integer
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Service updated
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Service not found
 *       500:
 *         description: Internal server error
 */
router.patch('/stylist/updateService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.updateServiceFromStylist);

/**
 * @swagger
 * /api/salons/stylist/removeService/{service_id}:
 *   delete:
 *     summary: Stylist removes a service
 *     description: Employee removes a service they offer
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: service_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Service removed
 *       400:
 *         description: Invalid service_id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Service not found
 *       500:
 *         description: Internal server error
 */
router.delete('/stylist/removeService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.removeServiceFromStylist);

/**
 * @swagger
 * /api/salons/stylist/myServices:
 *   get:
 *     summary: Get stylist's services
 *     description: Employee gets list of services they offer
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stylist services retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Employee not active
 *       500:
 *         description: Internal server error
 */
router.get('/stylist/myServices', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.getStylistServices);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists:
 *   get:
 *     summary: Get available stylists for a salon
 *     description: Customer gets list of stylists at a salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Available stylists retrieved
 *       400:
 *         description: Invalid salon_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.get('/:salon_id/stylists', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableStylists);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/timeslots:
 *   get:
 *     summary: Get available time slots for a stylist
 *     description: Customer gets available time slots for a specific stylist over a date range
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: duration_minutes
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Available time slots retrieved
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon or employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/:salon_id/stylists/:employee_id/timeslots', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableTimeSlotsRange);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/services:
 *   get:
 *     summary: Get stylist services (customer view)
 *     description: Customer gets services offered by a specific stylist
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Stylist services retrieved
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon or employee not found
 *       500:
 *         description: Internal server error
 */
router.get('/:salon_id/stylists/:employee_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getStylistServices);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/book:
 *   post:
 *     summary: Book a time slot with a stylist
 *     description: Customer books an appointment with a stylist for selected services
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: employee_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - service_ids
 *               - scheduled_start
 *             properties:
 *               service_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               scheduled_start:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Booking created
 *       400:
 *         description: Invalid parameters or time slot unavailable
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon, employee, or services not found
 *       409:
 *         description: Time slot no longer available
 *       500:
 *         description: Internal server error
 */
router.post('/:salon_id/stylists/:employee_id/book', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.bookTimeSlot);

/**
 * @swagger
 * /api/salons/{salon_id}/services:
 *   get:
 *     summary: Browse salon services
 *     description: Customer browses all services offered at a salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: salon_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Salon services retrieved
 *       400:
 *         description: Invalid salon_id
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.get('/:salon_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.browseSalonServices);

/**
 * @swagger
 * /api/salons/information:
 *   get:
 *     summary: Get salon information
 *     description: Owner gets their salon's full information
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon information retrieved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.get('/information', authenticateToken, roleAuthorization(['OWNER']), salonController.getSalonInformation);

/**
 * @swagger
 * /api/salons/track-salon-event:
 *   post:
 *     summary: Track salon event for analytics
 *     description: Track customer events like page views for salon analytics
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - salon_id
 *               - event_type
 *             properties:
 *               salon_id:
 *                 type: integer
 *               event_type:
 *                 type: string
 *                 enum: [PAGE_VIEW, STYLIST_VIEW, SERVICE_VIEW, BOOK_START]
 *     responses:
 *       200:
 *         description: Event tracked
 *       400:
 *         description: Invalid parameters
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/track-salon-event', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.trackSalonEvent);

/**
 * @swagger
 * /api/salons/top-metrics:
 *   get:
 *     summary: Get top salon metrics
 *     description: Owner gets dashboard metrics for their salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Top metrics retrieved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Salon not found
 *       500:
 *         description: Internal server error
 */
router.get('/top-metrics', authenticateToken, roleAuthorization(['OWNER']), salonController.getTopSalonMetrics);

/**
 * @swagger
 * /api/salons/check-salon-status:
 *   get:
 *     summary: Check salon status
 *     description: Customer checks if a salon is open/closed
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon status retrieved
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/check-salon-status', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.checkSalonStatus);

module.exports = router;
