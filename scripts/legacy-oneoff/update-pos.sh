#!/bin/bash
sed -i 's/import { generateZatcaQR } from "..\/services\/zatcaService";/import { generateZatcaQR } from "..\/services\/zatcaService";\nimport { ThermalInvoice, InvoiceData } from ".\/printing\/InvoiceReceipt";/' src/components/POS.tsx
