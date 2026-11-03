-- LOCAL/CI fixtures only, AFTER schema installation. No real business data.
INSERT INTO auth.users(id,email) VALUES('2375b60c-c418-47c2-b157-af80b262fadf','synthetic-owner@example.invalid');
INSERT INTO public.profiles(id,full_name,role,is_active)
VALUES('2375b60c-c418-47c2-b157-af80b262fadf','Synthetic local owner','owner',true)
ON CONFLICT(id) DO UPDATE SET role='owner',is_active=true;
INSERT INTO public.ingredients(kode,nama,kategori,satuan,harga)
VALUES('LOCAL-TEST','Synthetic material','TEST','g',1);
