-- Rollback of 20270124000005_appointments.sql (the appointments booked since are lost).
DROP TABLE IF EXISTS public.appointments;
