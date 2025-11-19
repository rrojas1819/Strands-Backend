const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/salons/check:
 *   get:
 *     summary: Check if owner has a salon
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Check result retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);

/**
 * @swagger
 * /api/salons/create:
 *   post:
 *     summary: Create a salon
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
 *               - salon_name
 *               - salon_type
 *             properties:
 *               salon_name:
 *                 type: string
 *               salon_type:
 *                 type: string
 *               address:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Salon created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);

/**
 * @swagger
 * /api/salons/approve:
 *   patch:
 *     summary: Approve a salon (Admin)
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
 *             properties:
 *               salon_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Salon approved successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
router.patch('/approve', authenticateToken, roleAuthorization(['ADMIN']), salonController.approveSalon);

/**
 * @swagger
 * /api/salons/browse:
 *   get:
 *     summary: Browse salons
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salons retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin or Customer role required
 */
router.get('/browse', authenticateToken, roleAuthorization(['ADMIN', 'CUSTOMER']), salonController.browseSalons);

/**
 * @swagger
 * /api/salons/addEmployee:
 *   post:
 *     summary: Add employee to salon (Owner)
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
 *               - employee_id
 *             properties:
 *               employee_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Employee added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/addEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.addEmployee);

/**
 * @swagger
 * /api/salons/removeEmployee:
 *   delete:
 *     summary: Remove employee from salon (Owner)
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
 *               - employee_id
 *             properties:
 *               employee_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Employee removed successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.delete('/removeEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.removeEmployee);

/**
 * @swagger
 * /api/salons/viewEmployees:
 *   post:
 *     summary: View employees of salon (Owner)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employees retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/viewEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.viewEmployees);

/**
 * @swagger
 * /api/salons/configureLoyaltyProgram:
 *   post:
 *     summary: Configure loyalty program (Owner)
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
 *             properties:
 *               salon_id:
 *                 type: integer
 *               program_details:
 *                 type: object
 *     responses:
 *       200:
 *         description: Loyalty program configured successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/configureLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.configureLoyaltyProgram);

/**
 * @swagger
 * /api/salons/updateLoyaltyProgram:
 *   patch:
 *     summary: Update loyalty program (Owner)
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
 *             properties:
 *               salon_id:
 *                 type: integer
 *               program_details:
 *                 type: object
 *     responses:
 *       200:
 *         description: Loyalty program updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.patch('/updateLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.updateLoyaltyProgram);

/**
 * @swagger
 * /api/salons/getLoyaltyProgram:
 *   get:
 *     summary: Get loyalty program (Owner)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loyalty program retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/getLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.getLoyaltyProgram);

/**
 * @swagger
 * /api/salons/getHours:
 *   get:
 *     summary: Get salon operating hours
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon hours retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/getHours', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER','ADMIN']), salonController.getSalonHours);

/**
 * @swagger
 * /api/salons/setHours:
 *   post:
 *     summary: Set salon operating hours (Owner)
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
 *               - hours
 *             properties:
 *               salon_id:
 *                 type: integer
 *               hours:
 *                 type: object
 *     responses:
 *       200:
 *         description: Salon hours set successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/setHours', authenticateToken, roleAuthorization(['OWNER']), salonController.setSalonHours);

/**
 * @swagger
 * /api/salons/getEmployees:
 *   get:
 *     summary: Get employees (Owner)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employees retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/getEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployees);

/**
 * @swagger
 * /api/salons/setEmployeeAvailability/{employeeId}:
 *   post:
 *     summary: Set employee availability (Owner)
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
 *               - availability
 *             properties:
 *               availability:
 *                 type: object
 *     responses:
 *       200:
 *         description: Employee availability set successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.post('/setEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.setEmployeeAvailability);

/**
 * @swagger
 * /api/salons/getEmployeeAvailability/{employeeId}:
 *   get:
 *     summary: Get employee availability (Owner)
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
 *         description: Employee availability retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/getEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployeeAvailability);

/**
 * @swagger
 * /api/salons/stylist/createService:
 *   post:
 *     summary: Create and add service to stylist (Employee)
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
 *               - service_name
 *               - duration
 *               - price
 *             properties:
 *               service_name:
 *                 type: string
 *               duration:
 *                 type: integer
 *               price:
 *                 type: number
 *     responses:
 *       200:
 *         description: Service created and added successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.post('/stylist/createService', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.createAndAddServiceToStylist);

/**
 * @swagger
 * /api/salons/stylist/updateService/{service_id}:
 *   patch:
 *     summary: Update service from stylist (Employee)
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
 *               service_name:
 *                 type: string
 *               duration:
 *                 type: integer
 *               price:
 *                 type: number
 *     responses:
 *       200:
 *         description: Service updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.patch('/stylist/updateService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.updateServiceFromStylist);

/**
 * @swagger
 * /api/salons/stylist/removeService/{service_id}:
 *   delete:
 *     summary: Remove service from stylist (Employee)
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
 *         description: Service removed successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.delete('/stylist/removeService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.removeServiceFromStylist);

/**
 * @swagger
 * /api/salons/stylist/myServices:
 *   get:
 *     summary: Get stylist services (Employee)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stylist services retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Employee role required
 */
router.get('/stylist/myServices', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.getStylistServices);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists:
 *   get:
 *     summary: Get available stylists for a salon (Customer)
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
 *         description: Available stylists retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/:salon_id/stylists', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableStylists);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/timeslots:
 *   get:
 *     summary: Get available time slots for a stylist (Customer)
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
 *         description: Available time slots retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/:salon_id/stylists/:employee_id/timeslots', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableTimeSlotsRange);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/services:
 *   get:
 *     summary: Get stylist services (Customer)
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
 *         description: Stylist services retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/:salon_id/stylists/:employee_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getStylistServices);

/**
 * @swagger
 * /api/salons/{salon_id}/stylists/{employee_id}/book:
 *   post:
 *     summary: Book a time slot (Customer)
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
 *               - scheduled_start
 *               - service_ids
 *             properties:
 *               scheduled_start:
 *                 type: string
 *                 format: date-time
 *               service_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Time slot booked successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/:salon_id/stylists/:employee_id/book', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.bookTimeSlot);

/**
 * @swagger
 * /api/salons/{salon_id}/services:
 *   get:
 *     summary: Browse salon services (Customer)
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
 *         description: Salon services retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.get('/:salon_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.browseSalonServices);

/**
 * @swagger
 * /api/salons/information:
 *   get:
 *     summary: Get salon information (Owner)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon information retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/information', authenticateToken, roleAuthorization(['OWNER']), salonController.getSalonInformation);

/**
 * @swagger
 * /api/salons/track-salon-event:
 *   post:
 *     summary: Track salon event for user engagement (Customer)
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
 *     responses:
 *       200:
 *         description: Event tracked successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Customer role required
 */
router.post('/track-salon-event', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.trackSalonEvent);

/**
 * @swagger
 * /api/salons/top-metrics:
 *   get:
 *     summary: View salon metrics (Owner)
 *     tags: [Salons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Salon metrics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Owner role required
 */
router.get('/top-metrics', authenticateToken, roleAuthorization(['OWNER']), salonController.getTopSalonMetrics);

module.exports = router;
