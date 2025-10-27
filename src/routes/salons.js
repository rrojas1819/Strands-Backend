const express = require('express');
const router = express.Router();
const salonController = require('../controllers/salonController');
const {authenticateToken, roleAuthorization} = require('../middleware/auth.middleware');

// UAR 1.3/1.4 registration + salon type
router.get('/check', authenticateToken, roleAuthorization(['OWNER']), salonController.checkOwnerHasSalon);
router.post('/create', authenticateToken, roleAuthorization(['OWNER']), salonController.createSalon);

// UAR 1.5 salon approval
router.patch('/approve', authenticateToken, roleAuthorization(['ADMIN']), salonController.approveSalon);

// UAR 1.6 browse salons
router.get('/browse', authenticateToken, roleAuthorization(['ADMIN', 'CUSTOMER']), salonController.browseSalons);

// UAR 1.7 Add/Remove Employee
router.post('/addEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.addEmployee);
router.delete('/removeEmployee', authenticateToken, roleAuthorization(['OWNER']), salonController.removeEmployee);
router.post('/viewEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.viewEmployees);


// PLR 1.6 Configure Loyalty Program
router.post('/configureLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.configureLoyaltyProgram);
router.patch('/updateLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.updateLoyaltyProgram);
router.get('/getLoyaltyProgram', authenticateToken, roleAuthorization(['OWNER']), salonController.getLoyaltyProgram);

// BS 1.0 - Salon Operating Hours

//Technically anyone get the hours for a salon, but only owner can set the hours
router.get('/getHours', authenticateToken, roleAuthorization(['OWNER','EMPLOYEE','CUSTOMER','ADMIN']), salonController.getSalonHours);
router.post('/setHours', authenticateToken, roleAuthorization(['OWNER']), salonController.setSalonHours);

// BS 1.0 - Employee Availability Management (Owner only)
router.get('/getEmployees', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployees);
router.post('/setEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.setEmployeeAvailability);
router.get('/getEmployeeAvailability/:employeeId', authenticateToken, roleAuthorization(['OWNER']), salonController.getEmployeeAvailability);


// BS 1.01 - Stylist service management(Employee only)
router.post('/stylist/createService', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.createAndAddServiceToStylist);
router.patch('/stylist/updateService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.updateServiceFromStylist);
router.delete('/stylist/removeService/:service_id', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.removeServiceFromStylist);
router.get('/stylist/myServices', authenticateToken, roleAuthorization(['EMPLOYEE']), salonController.getStylistServices);


// BS 1.1 - Customer booking endpoints
router.get('/:salon_id/stylists', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableStylists);
router.get('/:salon_id/stylists/:employee_id/timeslots', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getAvailableTimeSlotsRange);
router.get('/:salon_id/stylists/:employee_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.getStylistServices);
router.post('/:salon_id/stylists/:employee_id/book', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.bookTimeSlot);
router.get('/:salon_id/services', authenticateToken, roleAuthorization(['CUSTOMER']), salonController.browseSalonServices);

router.get('/information', authenticateToken, roleAuthorization(['OWNER']), salonController.getSalonInformation);
module.exports = router;