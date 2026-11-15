-- Demo places (SPEC "Demo seeding"). Coordinates are HAND-ESTIMATED placeholders:
-- verify every row on a map before the demo. Apply after the init migration.
insert into places (slug, label, aliases, geom, kind, staffed_hours) values
 ('leavey',        'Leavey Library',            '{leavey,the library,leavey lib}',            st_makepoint(-118.28285, 34.02175)::geography, 'library',  null),
 ('doheny',        'Doheny Library',            '{doheny,doheny lib}',                        st_makepoint(-118.28370, 34.02015)::geography, 'library',  null),
 ('village',       'USC Village',               '{the village,village,usc village}',          st_makepoint(-118.28540, 34.02550)::geography, 'housing',  null),
 ('lorenzo',       'The Lorenzo',               '{the lo,lo,lorenzo,lorenzo apts}',           st_makepoint(-118.28000, 34.02650)::geography, 'housing',  null),
 ('icon',          'Icon Plaza',                '{icon,icon plaza}',                          st_makepoint(-118.28300, 34.02320)::geography, 'housing',  null),
 ('tuscany',       'Tuscany',                   '{tuscany}',                                  st_makepoint(-118.27850, 34.02450)::geography, 'housing',  null),
 ('gateway',       'Gateway',                   '{gateway}',                                  st_makepoint(-118.27700, 34.02600)::geography, 'housing',  null),
 ('cardinal',      'Cardinal Gardens',          '{cardinal gardens,cardinal,cg}',             st_makepoint(-118.28850, 34.02220)::geography, 'housing',  null),
 ('gate-jefferson','Jefferson/McClintock Gate', '{jefferson gate,mcclintock gate}',           st_makepoint(-118.28570, 34.02240)::geography, 'gate',     null),
 ('gate-figueroa', 'Figueroa Gate',             '{figueroa gate,figueroa}',                   st_makepoint(-118.28150, 34.02250)::geography, 'gate',     null),
 ('safe-leavey',   'Leavey 24-hour desk',       '{leavey desk}',                              st_makepoint(-118.28280, 34.02178)::geography, 'safe_spot','[0,24)'),
 ('safe-village',  'Village security kiosk',    '{village kiosk}',                            st_makepoint(-118.28520, 34.02540)::geography, 'safe_spot','[0,24)'),
 ('safe-dps',      'DPS station (3667 McClintock)', '{dps,dps station,dps hq}',               st_makepoint(-118.28450, 34.01880)::geography, 'safe_spot','[0,24)'),
 ('safe-blue-1',   'Blue-light phone (Trousdale)',  '{blue light trousdale}',                  st_makepoint(-118.28400, 34.02120)::geography, 'safe_spot','[0,24)'),
 ('safe-blue-2',   'Blue-light phone (Jefferson)',  '{blue light jefferson}',                  st_makepoint(-118.28300, 34.02260)::geography, 'safe_spot','[0,24)')
on conflict (slug) do nothing;
