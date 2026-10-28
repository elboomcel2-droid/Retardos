

USE refacc29_check_alp;

SELECT 
("01 ALPUYECA") AS tienda,
personnel_employee.emp_code,
personnel_employee.nickname,
personnel_employee.passport,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND
(iclock_transaction.punch_time >= CONCAT(CURDATE(),' 00:00:00') AND 
iclock_transaction.punch_time <= CONCAT(CURDATE(),' 13:30:59'))
BETWEEN "2026-01-02" AND "2026-01-14" 
ORDER BY
iclock_transaction.punch_time ASC;

/*************** tizoc ********************/

USE refacc29_check_tizoc_2;

SELECT 
("02 TIZOC") AS tienda,
personnel_employee.nickname,
personnel_employee.passport,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND
(iclock_transaction.punch_time >= CONCAT(CURDATE(),' 00:00:00') AND 
iclock_transaction.punch_time <= CONCAT(CURDATE(),' 13:30:59'))
ORDER BY
iclock_transaction.punch_time ASC;

/***************** 03 ACAPULCO ****************/
USE refacc29_check_acapulco;

SELECT 
("03 ACAPULCO") AS tienda,
personnel_employee.nickname,
personnel_employee.passport,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND
(iclock_transaction.punch_time >= CONCAT(CURDATE(),' 00:00:00') AND 
iclock_transaction.punch_time <= CONCAT(CURDATE(),' 13:30:59'))
ORDER BY
iclock_transaction.punch_time ASC;

/************ 04 CHilpancingo ******************/

USE refacc29_check_chilpancingo;

SELECT 
("04 CHILPANCINGO") AS tienda,
personnel_employee.nickname,
personnel_employee.passport,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND
(iclock_transaction.punch_time >= CONCAT(CURDATE(),' 00:00:00') AND 
iclock_transaction.punch_time <= CONCAT(CURDATE(),' 13:30:59'))
ORDER BY
iclock_transaction.punch_time ASC;





--------------------------------------------------------------------------------------------------------------------------------
##BUENA####

USE refacc29_check_alp;

SELECT 
("01 ALPUYECA") AS tienda,
personnel_employee.emp_code,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND iclock_transaction.punch_time
BETWEEN "2026-06-16" AND "2026-06-30" 
ORDER BY
iclock_transaction.punch_time ASC;





--------------------------------------------------------------------------
/*************** tizoc ********************/

USE refacc29_check_tizoc_2;

SELECT 
("02 TIZOC") AS tienda,
personnel_employee.emp_code,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND iclock_transaction.punch_time
BETWEEN "2026-09-01" AND "2026-09-16" 
ORDER BY
iclock_transaction.punch_time ASC;





--------------------------------------------------------------------------

/***************** 03 ACAPULCO ****************/

USE refacc29_check_acapulco;

SELECT 
("03 ACAPULCO") AS tienda,
personnel_employee.emp_code,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND iclock_transaction.punch_time
BETWEEN "2026-09-01" AND "2026-09-16"
ORDER BY
iclock_transaction.punch_time ASC;







--------------------------------------------------------------------------

/************ 04 Chilpancingo ******************/

USE refacc29_check_chilpancingo;

SELECT 
("04 CHILPANCINGO") AS tienda,
personnel_employee.emp_code,
personnel_employee.first_name,
personnel_employee.last_name,
iclock_transaction.punch_time
FROM
personnel_employee,
iclock_transaction
WHERE
personnel_employee.emp_code = iclock_transaction.emp_code
AND iclock_transaction.punch_time
BETWEEN "2026-07-01" AND "2026-07-12" 
ORDER BY
iclock_transaction.punch_time ASC;


