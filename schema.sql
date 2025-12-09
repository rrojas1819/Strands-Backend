-- MySQL dump 10.13  Distrib 8.0.44, for Linux (x86_64)
--
-- Host: 3.134.137.100    Database: Strands
-- ------------------------------------------------------
-- Server version	8.0.44-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `appointment_notes`
--

DROP TABLE IF EXISTS `appointment_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appointment_notes` (
  `note_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `author_user_id` int NOT NULL,
  `note` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`),
  UNIQUE KEY `uniq_booking_author` (`booking_id`,`author_user_id`),
  KEY `idx_an_booking_created` (`booking_id`,`created_at`),
  KEY `idx_an_author_created` (`author_user_id`,`created_at`),
  CONSTRAINT `fk_an_author` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_an_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `audit_log`
--

DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `audit_id` bigint NOT NULL AUTO_INCREMENT,
  `table_name` varchar(64) NOT NULL,
  `record_id` bigint NOT NULL,
  `action_type` enum('INSERT','UPDATE','DELETE','SOFT_DELETE','LOGIN','OTHER') NOT NULL,
  `old_value` json DEFAULT NULL,
  `new_value` json DEFAULT NULL,
  `changed_by` varchar(100) DEFAULT NULL,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_id`),
  KEY `idx_audit_table_record_time` (`table_name`,`record_id`,`changed_at`),
  KEY `idx_audit_changed_at` (`changed_at`),
  KEY `idx_audit_changed_by_time` (`changed_by`,`changed_at`)
) ENGINE=InnoDB AUTO_INCREMENT=442 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `auth_credentials`
--

DROP TABLE IF EXISTS `auth_credentials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_credentials` (
  `user_id` int NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `token_expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  KEY `idx_auth_credentials_updated_at` (`updated_at`),
  CONSTRAINT `fk_auth_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `available_rewards`
--

DROP TABLE IF EXISTS `available_rewards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `available_rewards` (
  `reward_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `discount_percentage` int NOT NULL,
  `note` text,
  `redeemed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `creationDate` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`reward_id`),
  KEY `idx_ar_user` (`user_id`),
  KEY `idx_ar_salon` (`salon_id`),
  KEY `idx_ar_user_salon` (`user_id`,`salon_id`),
  KEY `idx_ar_redeemed_at` (`redeemed_at`),
  KEY `idx_ar_user_active` (`user_id`,`active`),
  CONSTRAINT `fk_ar_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ar_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `billing_addresses`
--

DROP TABLE IF EXISTS `billing_addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `billing_addresses` (
  `billing_address_id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `full_name` varchar(160) DEFAULT NULL,
  `address_line1` varchar(160) NOT NULL,
  `address_line2` varchar(160) DEFAULT NULL,
  `city` varchar(120) NOT NULL,
  `state` varchar(64) DEFAULT NULL,
  `postal_code` varchar(20) NOT NULL,
  `country` varchar(64) NOT NULL DEFAULT 'USA',
  `phone` varchar(32) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`billing_address_id`),
  KEY `idx_ba_user` (`user_id`),
  KEY `idx_ba_postal` (`postal_code`),
  CONSTRAINT `fk_ba_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `booking_photos`
--

DROP TABLE IF EXISTS `booking_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `booking_photos` (
  `booking_photo_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `picture_id` int NOT NULL,
  `picture_type` enum('BEFORE','AFTER') DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`booking_photo_id`),
  KEY `idx_bsp_booking_id` (`booking_id`),
  KEY `idx_bsp_picture_id` (`picture_id`),
  KEY `idx_bsp_picture_type` (`picture_type`),
  CONSTRAINT `fk_bsp_booking_service` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bsp_picture` FOREIGN KEY (`picture_id`) REFERENCES `pictures` (`picture_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=96 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `booking_services`
--

DROP TABLE IF EXISTS `booking_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `booking_services` (
  `booking_service_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `service_id` int NOT NULL,
  `employee_id` int DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `duration_minutes` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`booking_service_id`),
  KEY `idx_bs_booking` (`booking_id`),
  KEY `idx_bs_employee` (`employee_id`),
  KEY `idx_bs_employee_status` (`employee_id`),
  KEY `idx_bs_service` (`service_id`),
  CONSTRAINT `fk_bs_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bs_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`),
  CONSTRAINT `fk_bs_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`)
) ENGINE=InnoDB AUTO_INCREMENT=426 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bookings` (
  `booking_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `customer_user_id` int NOT NULL,
  `scheduled_start` datetime NOT NULL,
  `scheduled_end` datetime NOT NULL,
  `status` enum('PENDING','SCHEDULED','CANCELED','COMPLETED') NOT NULL,
  `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `loyalty_seen` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`booking_id`),
  KEY `idx_bookings_salon_start` (`salon_id`,`scheduled_start`),
  KEY `idx_bookings_customer_start` (`customer_user_id`,`scheduled_start`),
  KEY `idx_bookings_salon_status_start` (`salon_id`,`status`,`scheduled_start`),
  KEY `idx_bookings_status_start` (`status`,`scheduled_start`),
  CONSTRAINT `fk_bk_cust` FOREIGN KEY (`customer_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_bk_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `bookings_chk_1` CHECK ((`scheduled_end` > `scheduled_start`))
) ENGINE=InnoDB AUTO_INCREMENT=407 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cart_items`
--

DROP TABLE IF EXISTS `cart_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cart_items` (
  `cart_item_id` int NOT NULL AUTO_INCREMENT,
  `cart_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cart_item_id`),
  UNIQUE KEY `uq_cart_product` (`cart_id`,`product_id`),
  KEY `idx_ci_product` (`product_id`),
  CONSTRAINT `fk_ci_cart` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`cart_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ci_prod` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `carts`
--

DROP TABLE IF EXISTS `carts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `carts` (
  `cart_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int NOT NULL,
  `status` enum('ACTIVE','ORDERED','ABANDONED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cart_id`),
  UNIQUE KEY `uq_one_active_cart` (`user_id`,`salon_id`),
  KEY `idx_carts_user_status_created` (`user_id`,`status`,`created_at`),
  KEY `idx_carts_salon_status` (`salon_id`,`status`),
  CONSTRAINT `fk_cart_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `fk_cart_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=65 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `credit_cards`
--

DROP TABLE IF EXISTS `credit_cards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `credit_cards` (
  `credit_card_id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `brand` enum('VISA','MASTERCARD','AMEX','DISCOVER','OTHER') NOT NULL,
  `last4` char(4) NOT NULL,
  `exp_month` tinyint NOT NULL,
  `exp_year` smallint NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `pan_length` tinyint unsigned DEFAULT NULL,
  `cvc_hmac` char(64) DEFAULT NULL,
  `card_hash` varchar(64) DEFAULT NULL,
  `encrypted_pan` varbinary(512) DEFAULT NULL,
  `is_temporary` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`credit_card_id`),
  KEY `idx_cc_user` (`user_id`),
  KEY `idx_cc_user_default` (`user_id`),
  CONSTRAINT `fk_cc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `credit_cards_chk_1` CHECK ((`exp_month` between 1 and 12)),
  CONSTRAINT `credit_cards_chk_2` CHECK ((`exp_year` between 2000 and 2100))
) ENGINE=InnoDB AUTO_INCREMENT=91 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customer_notes`
--

DROP TABLE IF EXISTS `customer_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_notes` (
  `note_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `customer_user_id` int NOT NULL,
  `author_user_id` int NOT NULL,
  `note` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`),
  KEY `fk_cpn_author` (`author_user_id`),
  KEY `idx_cpn_salon_customer_created` (`salon_id`,`customer_user_id`,`created_at`),
  KEY `idx_cpn_customer_created` (`customer_user_id`,`created_at`),
  CONSTRAINT `fk_cpn_author` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_cpn_cust` FOREIGN KEY (`customer_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_cpn_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_availability`
--

DROP TABLE IF EXISTS `employee_availability`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_availability` (
  `availability_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `weekday` tinyint NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `slot_interval_minutes` int NOT NULL DEFAULT '30',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`availability_id`),
  KEY `idx_ea_emp_weekday_start` (`employee_id`,`weekday`,`start_time`),
  CONSTRAINT `fk_ea_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`),
  CONSTRAINT `employee_availability_chk_1` CHECK ((`weekday` between 0 and 6)),
  CONSTRAINT `employee_availability_chk_2` CHECK ((`end_time` > `start_time`))
) ENGINE=InnoDB AUTO_INCREMENT=385 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_services`
--

DROP TABLE IF EXISTS `employee_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_services` (
  `employee_id` int NOT NULL,
  `service_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`employee_id`,`service_id`),
  UNIQUE KEY `uq_employee_service` (`employee_id`,`service_id`),
  KEY `idx_es_service_employee` (`service_id`,`employee_id`),
  CONSTRAINT `fk_es_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_es_srv` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee_unavailability`
--

DROP TABLE IF EXISTS `employee_unavailability`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_unavailability` (
  `unavailability_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `weekday` tinyint NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `slot_interval_minutes` int NOT NULL DEFAULT '30',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`unavailability_id`),
  KEY `idx_eua_emp_weekday_start` (`employee_id`,`weekday`,`start_time`),
  CONSTRAINT `fk_eua_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`),
  CONSTRAINT `employee_unavailability_chk_1` CHECK ((`weekday` between 0 and 6)),
  CONSTRAINT `employee_unavailability_chk_2` CHECK ((`end_time` > `start_time`))
) ENGINE=InnoDB AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employees`
--

DROP TABLE IF EXISTS `employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employees` (
  `employee_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `user_id` int NOT NULL,
  `title` varchar(120) DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`employee_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `user_id_2` (`user_id`),
  UNIQUE KEY `user_id_3` (`user_id`),
  UNIQUE KEY `user_id_4` (`user_id`),
  KEY `idx_employees_salon` (`salon_id`),
  KEY `idx_employees_user` (`user_id`),
  KEY `idx_employees_salon_active` (`salon_id`,`active`),
  CONSTRAINT `fk_emp_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `fk_emp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=541 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `logins`
--

DROP TABLE IF EXISTS `logins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `logins` (
  `login_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `login_date` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`login_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_login_date` (`login_date`),
  CONSTRAINT `fk_login_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3634 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `loyalty_memberships`
--

DROP TABLE IF EXISTS `loyalty_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_memberships` (
  `membership_id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int NOT NULL,
  `visits_count` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `total_visits_count` int DEFAULT NULL,
  PRIMARY KEY (`membership_id`),
  KEY `idx_lm_user` (`user_id`),
  KEY `idx_lm_salon` (`salon_id`),
  KEY `idx_lm_user_salon` (`user_id`,`salon_id`),
  CONSTRAINT `fk_lm_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `loyalty_programs`
--

DROP TABLE IF EXISTS `loyalty_programs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_programs` (
  `program_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `target_visits` int NOT NULL,
  `discount_percentage` int NOT NULL,
  `note` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`program_id`),
  UNIQUE KEY `uq_lp_salon` (`salon_id`),
  CONSTRAINT `fk_lp_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notifications_inbox`
--

DROP TABLE IF EXISTS `notifications_inbox`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications_inbox` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int DEFAULT NULL,
  `employee_id` int DEFAULT NULL,
  `sender_email` varchar(64) NOT NULL,
  `email` varchar(64) NOT NULL,
  `booking_id` int DEFAULT NULL,
  `payment_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `review_id` int DEFAULT NULL,
  `type_code` varchar(64) NOT NULL,
  `promo_code` varchar(64) DEFAULT NULL,
  `user_promo_id` int DEFAULT NULL,
  `status` enum('UNREAD','READ') NOT NULL DEFAULT 'UNREAD',
  `message` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` datetime DEFAULT NULL,
  PRIMARY KEY (`notification_id`),
  KEY `idx_notifications_user_created` (`user_id`,`created_at`),
  KEY `idx_notifications_type` (`type_code`),
  KEY `idx_notifications_booking` (`booking_id`),
  KEY `idx_notifications_salon` (`salon_id`),
  KEY `idx_notifications_user_promo` (`user_promo_id`),
  KEY `idx_user_status` (`user_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=57 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `order_items`
--

DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `order_item_id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `purchase_price` decimal(10,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_item_id`),
  KEY `idx_order_items_order_id` (`order_id`),
  KEY `idx_order_items_product_id` (`product_id`),
  KEY `idx_order_items_order_product` (`order_id`,`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=67 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `order_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  `tax` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `order_code` varchar(16) DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  UNIQUE KEY `order_code` (`order_code`),
  KEY `idx_orders_user_created` (`user_id`,`created_at`),
  KEY `idx_orders_salon_created` (`salon_id`,`created_at`),
  KEY `idx_orders_status_created` (`created_at`),
  KEY `idx_orders_user_status` (`user_id`),
  KEY `idx_orders_salon_status` (`salon_id`),
  CONSTRAINT `fk_order_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `fk_order_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `payment_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int DEFAULT NULL,
  `user_promo_id` int DEFAULT NULL,
  `order_id` int DEFAULT NULL,
  `credit_card_id` bigint DEFAULT NULL,
  `billing_address_id` bigint DEFAULT NULL,
  `reward_id` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` enum('PENDING','SUCCEEDED','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`payment_id`),
  KEY `idx_payments_booking` (`booking_id`),
  KEY `idx_payments_order` (`order_id`),
  KEY `idx_payments_status_created` (`status`,`created_at`),
  KEY `idx_payments_order_status` (`order_id`,`status`),
  KEY `idx_payments_booking_status` (`booking_id`,`status`),
  KEY `idx_payments_cc` (`credit_card_id`),
  KEY `idx_payments_ba` (`billing_address_id`),
  KEY `fk_payments_available_reward` (`reward_id`),
  CONSTRAINT `fk_pay_ba` FOREIGN KEY (`billing_address_id`) REFERENCES `billing_addresses` (`billing_address_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pay_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`),
  CONSTRAINT `fk_pay_cc` FOREIGN KEY (`credit_card_id`) REFERENCES `credit_cards` (`credit_card_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pay_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `fk_payments_available_reward` FOREIGN KEY (`reward_id`) REFERENCES `available_rewards` (`reward_id`)
) ENGINE=InnoDB AUTO_INCREMENT=309 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pictures`
--

DROP TABLE IF EXISTS `pictures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pictures` (
  `picture_id` int NOT NULL AUTO_INCREMENT,
  `s3_key` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`picture_id`)
) ENGINE=InnoDB AUTO_INCREMENT=110 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `product_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `sku` varchar(64) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `category` enum('SHAMPOO','CONDITIONER','HAIR TREATMENT','STYLING PRODUCT','HAIR COLOR','HAIR ACCESSORIES','SKINCARE','OTHER') NOT NULL,
  `stock_qty` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`),
  UNIQUE KEY `uq_sku_per_salon` (`salon_id`,`sku`),
  KEY `idx_products_salon` (`salon_id`),
  KEY `idx_products_salon_category` (`salon_id`,`category`),
  CONSTRAINT `fk_prod_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`)
) ENGINE=InnoDB AUTO_INCREMENT=72 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `review_replies`
--

DROP TABLE IF EXISTS `review_replies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `review_replies` (
  `reply_id` int NOT NULL AUTO_INCREMENT,
  `review_id` int NOT NULL,
  `author_user_id` int NOT NULL,
  `message` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reply_id`),
  KEY `idx_rr_review` (`review_id`),
  KEY `idx_rr_review_created` (`review_id`,`created_at`),
  KEY `idx_rr_author_created` (`author_user_id`,`created_at`),
  CONSTRAINT `fk_rr_author` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_rr_review` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`review_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reviews`
--

DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `review_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `user_id` int NOT NULL,
  `rating` decimal(2,1) NOT NULL,
  `message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`review_id`),
  UNIQUE KEY `uq_review_once` (`salon_id`,`user_id`),
  KEY `idx_reviews_salon_created` (`salon_id`,`created_at`),
  KEY `idx_reviews_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_rev_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `fk_rev_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `reviews_chk_1` CHECK ((`rating` between 0 and 5))
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salon_availability`
--

DROP TABLE IF EXISTS `salon_availability`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salon_availability` (
  `salon_availability_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `weekday` tinyint NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`salon_availability_id`),
  KEY `idx_sa_emp_weekday_start` (`salon_id`,`weekday`,`start_time`),
  CONSTRAINT `fk_sa_emp` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`),
  CONSTRAINT `salon_availability_chk_1` CHECK ((`weekday` between 0 and 6)),
  CONSTRAINT `salon_availability_chk_2` CHECK ((`end_time` > `start_time`))
) ENGINE=InnoDB AUTO_INCREMENT=637 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salon_clicks`
--

DROP TABLE IF EXISTS `salon_clicks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salon_clicks` (
  `engagement_id` int NOT NULL AUTO_INCREMENT,
  `event_name` varchar(64) NOT NULL,
  `salon_id` int NOT NULL,
  `clicks` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`engagement_id`),
  UNIQUE KEY `uk_salon_event` (`salon_id`,`event_name`),
  KEY `idx_event_name` (`event_name`),
  CONSTRAINT `fk_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`)
) ENGINE=InnoDB AUTO_INCREMENT=942 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salon_photos`
--

DROP TABLE IF EXISTS `salon_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salon_photos` (
  `salon_photo_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `picture_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`salon_photo_id`),
  KEY `idx_sp_salon_id` (`salon_id`),
  KEY `idx_sp_picture_id` (`picture_id`),
  CONSTRAINT `fk_sp_picture` FOREIGN KEY (`picture_id`) REFERENCES `pictures` (`picture_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sp_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `salons`
--

DROP TABLE IF EXISTS `salons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salons` (
  `salon_id` int NOT NULL AUTO_INCREMENT,
  `owner_user_id` int NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `category` enum('NAIL SALON','HAIR SALON','EYELASH STUDIO','SPA & WELLNESS','BARBERSHOP','FULL SERVICE BEAUTY') NOT NULL DEFAULT 'HAIR SALON',
  `phone` varchar(32) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address` varchar(160) DEFAULT NULL,
  `city` varchar(120) DEFAULT NULL,
  `state` varchar(64) DEFAULT NULL,
  `postal_code` varchar(20) DEFAULT NULL,
  `country` varchar(64) DEFAULT 'USA',
  `status` enum('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  `approval_date` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `timezone` varchar(64) NOT NULL DEFAULT 'America/New_York',
  PRIMARY KEY (`salon_id`),
  UNIQUE KEY `owner_user_id` (`owner_user_id`),
  KEY `idx_salons_owner` (`owner_user_id`),
  KEY `idx_salons_status` (`status`),
  KEY `idx_salons_owner_status` (`owner_user_id`,`status`),
  KEY `idx_salons_city_state` (`city`,`state`),
  KEY `idx_salons_postal_code` (`postal_code`),
  CONSTRAINT `fk_salon_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1148 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `services`
--

DROP TABLE IF EXISTS `services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `service_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `duration_minutes` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`service_id`),
  KEY `idx_services_salon_active` (`salon_id`,`active`),
  CONSTRAINT `fk_srv_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`)
) ENGINE=InnoDB AUTO_INCREMENT=233 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `staff_review_replies`
--

DROP TABLE IF EXISTS `staff_review_replies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_review_replies` (
  `staff_reply_id` int NOT NULL AUTO_INCREMENT,
  `staff_review_id` int NOT NULL,
  `author_user_id` int NOT NULL,
  `message` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`staff_reply_id`),
  KEY `idx_srr_staff_review` (`staff_review_id`),
  KEY `idx_srr_created` (`staff_review_id`,`created_at`),
  KEY `idx_srr_author_created` (`author_user_id`,`created_at`),
  CONSTRAINT `fk_srr_author` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_srr_staff_review` FOREIGN KEY (`staff_review_id`) REFERENCES `staff_reviews` (`staff_review_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `staff_reviews`
--

DROP TABLE IF EXISTS `staff_reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_reviews` (
  `staff_review_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `user_id` int NOT NULL,
  `rating` decimal(2,1) NOT NULL,
  `message` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`staff_review_id`),
  UNIQUE KEY `uq_review_once` (`user_id`,`employee_id`),
  KEY `idx_srev_employee_created` (`employee_id`,`created_at`),
  KEY `idx_srev_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_srev_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`),
  CONSTRAINT `fk_srev_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `staff_reviews_chk_1` CHECK ((`rating` between 0 and 5))
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_employee_notes`
--

DROP TABLE IF EXISTS `user_employee_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_employee_notes` (
  `note_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `user_id` int NOT NULL,
  `note` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`),
  UNIQUE KEY `uq_uen` (`employee_id`,`user_id`,`created_at`),
  KEY `idx_uen_user_employee_created` (`user_id`,`employee_id`,`created_at`),
  CONSTRAINT `fk_uen_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`),
  CONSTRAINT `fk_uen_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_promotions`
--

DROP TABLE IF EXISTS `user_promotions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_promotions` (
  `user_promo_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `salon_id` int NOT NULL,
  `promo_code` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL,
  `discount_pct` decimal(5,2) DEFAULT NULL,
  `issued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime DEFAULT NULL,
  `status` enum('ISSUED','REDEEMED','EXPIRED') NOT NULL DEFAULT 'ISSUED',
  `redeemed_at` datetime DEFAULT NULL,
  `booking_id` int DEFAULT NULL,
  `payment_id` int DEFAULT NULL,
  PRIMARY KEY (`user_promo_id`),
  UNIQUE KEY `uq_user_salon_code` (`user_id`,`salon_id`,`promo_code`)
) ENGINE=InnoDB AUTO_INCREMENT=50 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `profile_picture_url` varchar(512) DEFAULT NULL,
  `role` enum('ADMIN','OWNER','CUSTOMER','EMPLOYEE') NOT NULL DEFAULT 'CUSTOMER',
  `last_login_at` datetime DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_last_login` (`last_login_at`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_active_role` (`active`,`role`)
) ENGINE=InnoDB AUTO_INCREMENT=3664 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-12-07 23:44:59
