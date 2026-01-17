-- Add admin users for shorna@gmail.com and tulon@gmail.com
INSERT INTO public.admin_users (user_id)
VALUES 
  ('d45a86fe-ab82-4fa1-9fc7-8bba12c23c4e'), -- shorna@gmail.com
  ('80d1b8e2-cbd9-43b0-a9f8-651fe7fba2d9')  -- tulon@gmail.com
ON CONFLICT (user_id) DO NOTHING;