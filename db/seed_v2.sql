INSERT INTO sites(site_id, site_code, site_name) VALUES (1, 'IDEAL', 'Ideal Gas Springs');

INSERT INTO production_lines(line_id, site_id, line_code, line_name, line_type) VALUES
 (1, 1, 'AL1', 'Assembly Line 1', 'ASSEMBLY'),
 (2, 1, 'AL2', 'Assembly Line 2', 'ASSEMBLY'),
 (3, 1, 'TUBE', 'Tube Shop', 'FEEDER'),
 (4, 1, 'RIVET', 'Riveting Shop', 'FEEDER'),
 (5, 1, 'WH', 'Warehouse Logistics', 'WAREHOUSE');

INSERT INTO product_families(family_id, family_code, family_name, assembly_line_id) VALUES
 (1, '818', '818 Product Family', 2),
 (2, '1021', '1021 Product Family', 2),
 (3, '615', '615 Product Family', 1);

INSERT INTO products(product_id, family_id, material_code, segment, bom_available) VALUES
 (1, 1, '818-IL-1224', 'AUTOMOBILE SPARE', 1),
 (2, 1, '818-IL-1226', 'AUTOMOBILE SPARE', 1),
 (3, 3, '615-IL-382', 'NON AUTO', 1);

INSERT INTO stations(station_id, site_id, station_code, station_name, shop_type, structural_bottleneck) VALUES
 (1,1,'TUBE_CLEAN','Tube Cleaning','TUBE_FEEDER',0),
 (2,1,'TUBE_PART','Tube Parting','TUBE_FEEDER',0),
 (3,1,'TUBE_FLEX','Tube Flexoning','TUBE_FEEDER',0),
 (4,1,'TUBE_CHAMFER','Tube Chamfer','TUBE_FEEDER',0),
 (5,1,'TUBE_FOLD','Tube Folding','TUBE_FEEDER',1),
 (6,1,'WELD_01','Welding MC 01','TUBE_FEEDER',1),
 (7,1,'WELD_02','Welding MC 02','TUBE_FEEDER',1),
 (8,1,'ROD_PISTON','Rod / Piston Assembly','RIVETING_FEEDER',0),
 (9,1,'GUIDE_ASSY','Guide Assembly','RIVETING_FEEDER',1),
 (10,1,'OIL_FILL_AL1','Oil Filling','ASSEMBLY',0),
 (11,1,'CLOSE_AL1','Closing Machine','ASSEMBLY',0),
 (12,1,'DIMPLE_AL1','Dimpling Machine','ASSEMBLY',0),
 (13,1,'GAS_FILL_AL1','Gas Filling','ASSEMBLY',0),
 (14,1,'FORCE_TEST_AL1','Force Testing','ASSEMBLY',0),
 (15,1,'PUNCH_AL1','Punching','ASSEMBLY',0),
 (16,1,'BKT_RIVET_AL1','Bkt Riveting / End Fitting','ASSEMBLY',0),
 (17,1,'OIL_FILL_04','Oil Filling 04','ASSEMBLY',0),
 (18,1,'CLOSE_05','Closing MC-05','ASSEMBLY',0),
 (19,1,'DIMPLE_DM02','Dimpling MC DM-02','ASSEMBLY',0),
 (20,1,'GAS_FILL_AL2','Gas Filling','ASSEMBLY',0),
 (21,1,'FORCE_TEST_AL2','Force Testing','ASSEMBLY',0),
 (22,1,'BKT_RIVET_AL2','Bracket Riveting','ASSEMBLY',0),
 (23,1,'PUNCH_AL2','Punching','ASSEMBLY',0),
 (24,1,'SLEEVE_CUT','Sleeve Cutting','WAREHOUSE',0),
 (25,1,'SLEEVE_WRAP','PL Sleeve Wrapping','WAREHOUSE',1),
 (26,1,'PRINT_PACK','Printing / Box Packing','WAREHOUSE',0);

INSERT INTO line_stations(line_station_id,line_id,station_id,sequence_no) VALUES
 (1,3,1,1),(2,3,2,2),(3,3,3,3),(4,3,4,4),(5,3,5,5),(6,3,6,6),(7,3,7,7),
 (8,4,8,1),(9,4,9,2),
 (10,2,10,1),(11,2,11,2),(12,2,12,3),(13,2,13,4),(14,2,14,5),(15,2,15,6),(16,2,16,7),
 (17,1,17,1),(18,1,18,2),(19,1,19,3),(20,1,20,4),(21,1,21,5),(22,1,22,6),(23,1,23,7),
 (24,5,24,1),(25,5,25,2),(26,5,26,3);

-- Representative product-specific routes. The workbook importer expands these for every material code.
INSERT INTO product_routes(product_id,line_station_id,sequence_no,cycle_time_seconds) VALUES
 (1,1,1,6),(1,2,2,6),(1,3,3,5),(1,4,4,8),(1,5,5,15),(1,7,6,15),(1,8,7,8),(1,9,8,16),
 (1,10,9,6),(1,11,10,7),(1,12,11,7),(1,13,12,6.5),(1,14,13,6.5),(1,15,14,6),(1,16,15,7),(1,26,16,12),
 (2,1,1,6),(2,2,2,6),(2,3,3,5),(2,4,4,8),(2,5,5,15),(2,7,6,15),(2,8,7,8),(2,9,8,16),
 (2,10,9,6),(2,11,10,7),(2,12,11,7),(2,13,12,6.5),(2,14,13,6.5),(2,15,14,6),(2,16,15,7),(2,26,16,12),
 (3,1,1,6),(3,2,2,6),(3,3,3,5),(3,4,4,8),(3,5,5,15),(3,6,6,15),(3,8,7,8),(3,9,8,16),
 (3,17,9,6),(3,18,10,7),(3,19,11,7),(3,20,12,6.5),(3,21,13,6.5),(3,22,14,7),(3,23,15,6),
 (3,24,16,15),(3,25,17,20),(3,26,18,12);

INSERT INTO components(component_id,material_code,description,base_unit) VALUES
 (1,'1022-263','M6 Plastic Ball Socket With Clip','No.'),(2,'615-024','T E. M6X1.0 Forging','No.'),
 (3,'615-029','Oil Servoteleshocab','ML'),(4,'818-001','Tube 18x16 Mahesh Mat.','MTR'),
 (5,'818-005','Piston','No.'),(6,'818-011','Seal','No.'),(7,'818-243','Single Carton Box 45x35x555mm','No.'),
 (8,'818-WT-001','M6X191 Welded','No.'),(9,'1022-058','Ball Pin M8','No.'),(10,'818-148','Tube 18x255','No.'),
 (11,'818-276','Piston Rod 8X230 M6 QPQ','No.'),(12,'818-WT-006','M6X255 Welded','No.');

INSERT INTO product_bom(product_id,component_id,quantity,unit,effective_from) VALUES
 (1,1,2,'No.','2026-01-01'),(1,2,1,'No.','2026-01-01'),(1,3,4.5,'ML','2026-01-01'),
 (1,4,0.191,'MTR','2026-01-01'),(1,5,1,'No.','2026-01-01'),(1,6,1,'No.','2026-01-01'),
 (1,7,1,'No.','2026-01-01'),(1,8,1,'No.','2026-01-01'),(2,9,1,'No.','2026-01-01'),
 (2,4,0.255,'MTR','2026-01-01'),(2,10,1,'No.','2026-01-01'),(2,11,1,'No.','2026-01-01'),
 (2,12,1,'No.','2026-01-01');

-- 0.80 × 0.75 × 1.00 = 0.60 baseline OEE; all three factors remain editable.
INSERT INTO oee_profiles(oee_profile_id,site_id,profile_name,availability,performance,quality,effective_from)
VALUES (1,1,'Baseline 60% OEE',0.80,0.75,1.00,'2026-01-01');

INSERT INTO planning_periods(planning_period_id,site_id,period_name,start_date,end_date,status)
VALUES (1,1,'August 2026','2026-08-01','2026-08-31','DRAFT');

INSERT INTO capacity_plans(capacity_plan_id,planning_period_id,line_id,oee_profile_id,plan_type,status)
VALUES (1,1,2,1,'DAILY_ASSEMBLY','DRAFT'),(2,1,1,1,'DAILY_ASSEMBLY','DRAFT'),
       (3,1,3,1,'MONTHLY_FEEDER','DRAFT'),(4,1,4,1,'MONTHLY_FEEDER','DRAFT');

INSERT INTO production_orders(production_order_id,capacity_plan_id,product_id,order_reference,planned_quantity,due_date)
VALUES (1,1,1,'AUG26-818-1224-01',2000,'2026-08-08'),
       (2,1,2,'AUG26-818-1226-01',3000,'2026-08-15'),
       (3,2,3,'AUG26-615-382-01',2200,'2026-08-10');
