-- Set up Topas Prompt Library Schema

-- users
CREATE TABLE IF NOT EXISTS public.users (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  email text NOT NULL,
  name text,
  is_active boolean DEFAULT true,
  is_super_admin boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- User trigger on Auth sign up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- markets
CREATE TABLE IF NOT EXISTS public.markets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL
);

-- user_market_roles
CREATE TABLE IF NOT EXISTS public.user_market_roles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  market_id uuid REFERENCES public.markets(id) ON DELETE CASCADE NOT NULL,
  role text CHECK (role IN ('view', 'edit')) NOT NULL,
  UNIQUE (user_id, market_id)
);

-- topics
CREATE TABLE IF NOT EXISTS public.topics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id uuid REFERENCES public.markets(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- prompts
CREATE TABLE IF NOT EXISTS public.prompts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id uuid REFERENCES public.topics(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  content text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- tags
CREATE TABLE IF NOT EXISTS public.tags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id)
);

-- prompt_tags
CREATE TABLE IF NOT EXISTS public.prompt_tags (
  prompt_id uuid REFERENCES public.prompts(id) ON DELETE CASCADE NOT NULL,
  tag_id uuid REFERENCES public.tags(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (prompt_id, tag_id)
);

-- prompt_versions
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id uuid REFERENCES public.prompts(id) ON DELETE CASCADE NOT NULL,
  version int NOT NULL,
  content text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Trigger for versioning
CREATE OR REPLACE FUNCTION public.increment_prompt_version()
RETURNS trigger AS $$
DECLARE
  next_version int;
BEGIN
  -- We only save a version if content or title changed
  IF old.content IS NULL OR new.content <> old.content OR new.title <> old.title THEN
    SELECT coalesce(max(version), 0) + 1 INTO next_version FROM public.prompt_versions WHERE prompt_id = old.id;
    
    INSERT INTO public.prompt_versions (prompt_id, version, content, created_by)
    VALUES (old.id, next_version, old.content, old.created_by);
    
    new.updated_at = now();
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_prompt_update ON public.prompts;
CREATE TRIGGER on_prompt_update
  BEFORE UPDATE ON public.prompts
  FOR EACH ROW EXECUTE PROCEDURE public.increment_prompt_version();

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_market_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

-- Helper to check if current user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
RETURNS boolean AS $$
  SELECT is_super_admin FROM public.users WHERE id = uid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper to check market role
CREATE OR REPLACE FUNCTION public.has_market_role(target_market_id uuid, target_roles text[])
RETURNS boolean AS $$
BEGIN
  IF public.is_super_admin(auth.uid()) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_market_roles
    WHERE user_id = auth.uid() AND market_id = target_market_id AND role = ANY(target_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================
-- RLS POLICIES
-- ====================

-- Users
DROP POLICY IF EXISTS "Public can view users" ON public.users;
CREATE POLICY "Public can view users" ON public.users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update users" ON public.users;
CREATE POLICY "Admins can update users" ON public.users FOR UPDATE USING (public.is_super_admin(auth.uid()));

-- Markets
DROP POLICY IF EXISTS "Users can view markets they have role in" ON public.markets;
CREATE POLICY "Public can view markets" ON public.markets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage markets" ON public.markets;
CREATE POLICY "Admins can manage markets" ON public.markets FOR ALL USING (public.is_super_admin(auth.uid()));

-- User Market Roles
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_market_roles;
CREATE POLICY "Users can view their own roles" ON public.user_market_roles FOR SELECT USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_market_roles;
CREATE POLICY "Admins can manage roles" ON public.user_market_roles FOR ALL USING (public.is_super_admin(auth.uid()));

-- Topics
DROP POLICY IF EXISTS "Users can view topics if they have market access" ON public.topics;
CREATE POLICY "Users can view topics if they have market access" ON public.topics FOR SELECT USING (
  public.has_market_role(market_id, array['view', 'edit'])
);

DROP POLICY IF EXISTS "Users can edit topics if they have edit access" ON public.topics;
CREATE POLICY "Users can edit topics if they have edit access" ON public.topics FOR INSERT WITH CHECK (public.has_market_role(market_id, array['edit']));
CREATE POLICY "Users can update topics if they have edit access" ON public.topics FOR UPDATE USING (public.has_market_role(market_id, array['edit']));
CREATE POLICY "Users can delete topics if they have edit access" ON public.topics FOR DELETE USING (public.has_market_role(market_id, array['edit']));

-- Prompts
DROP POLICY IF EXISTS "Users can view prompts if they have market access" ON public.prompts;
CREATE POLICY "Users can view prompts if they have market access" ON public.prompts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.topics WHERE id = topic_id AND public.has_market_role(market_id, array['view', 'edit']))
);

DROP POLICY IF EXISTS "Users can edit prompts if they have edit access" ON public.prompts;
CREATE POLICY "Users can edit prompts if they have edit access" ON public.prompts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.topics WHERE id = topic_id AND public.has_market_role(market_id, array['edit']))
);
CREATE POLICY "Users can update prompts if they have edit access" ON public.prompts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.topics WHERE id = topic_id AND public.has_market_role(market_id, array['edit']))
);
CREATE POLICY "Users can delete prompts if they have edit access" ON public.prompts FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.topics WHERE id = topic_id AND public.has_market_role(market_id, array['edit']))
);

-- Prompt Versions
DROP POLICY IF EXISTS "Users can view versions if they have market access" ON public.prompt_versions;
CREATE POLICY "Users can view versions if they have market access" ON public.prompt_versions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.prompts p
    JOIN public.topics t ON p.topic_id = t.id
    WHERE p.id = prompt_id AND public.has_market_role(t.market_id, array['view', 'edit'])
  )
);

DROP POLICY IF EXISTS "Users can manage versions if they have edit access" ON public.prompt_versions;
CREATE POLICY "Users can manage versions if they have edit access" ON public.prompt_versions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.prompts p
    JOIN public.topics t ON p.topic_id = t.id
    WHERE p.id = prompt_id AND public.has_market_role(t.market_id, array['edit'])
  )
);

-- Tags
DROP POLICY IF EXISTS "All authenticated users can select tags" ON public.tags;
CREATE POLICY "All authenticated users can select tags" ON public.tags FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "All authenticated users can insert tags" ON public.tags;
CREATE POLICY "All authenticated users can insert tags" ON public.tags FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage tags" ON public.tags;
CREATE POLICY "Admins can manage tags" ON public.tags FOR UPDATE USING (public.is_super_admin(auth.uid()));
CREATE POLICY "Admins can delete tags" ON public.tags FOR DELETE USING (public.is_super_admin(auth.uid()));

-- Prompt Tags
DROP POLICY IF EXISTS "Users can view prompt tags" ON public.prompt_tags;
CREATE POLICY "Users can view prompt tags" ON public.prompt_tags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.prompts p
    JOIN public.topics t ON p.topic_id = t.id
    WHERE p.id = prompt_id AND public.has_market_role(t.market_id, array['view', 'edit'])
  )
);

DROP POLICY IF EXISTS "Users can manage prompt tags" ON public.prompt_tags;
CREATE POLICY "Users can manage prompt tags" ON public.prompt_tags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.prompts p
    JOIN public.topics t ON p.topic_id = t.id
    WHERE p.id = prompt_id AND public.has_market_role(t.market_id, array['edit'])
  )
);

-- Create API schema / function for search
CREATE OR REPLACE FUNCTION public.search_prompts(
  p_market_id uuid DEFAULT NULL,
  p_topic_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_search_text text DEFAULT NULL
)
RETURNS SETOF public.prompts AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT p.*
  FROM public.prompts p
  JOIN public.topics t ON p.topic_id = t.id
  LEFT JOIN public.prompt_tags pt ON p.id = pt.prompt_id
  WHERE
    (p_market_id IS NULL OR t.market_id = p_market_id)
    AND (p_topic_id IS NULL OR p.topic_id = p_topic_id)
    AND (p_tag_ids IS NULL OR pt.tag_id = ANY(p_tag_ids))
    AND (p_search_text IS NULL OR p.title ILIKE '%' || p_search_text || '%' OR p.content ILIKE '%' || p_search_text || '%')
    AND public.has_market_role(t.market_id, array['view', 'edit']);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================
-- TROUBLESHOOTING & INITIAL DATA
-- ====================
-- Run these if your dashboard is empty!

-- 1. SYNC EXISTING USERS
-- If you have users in auth.users who are not in public.users, run this:
INSERT INTO public.users (id, email, name)
SELECT id, email, raw_user_meta_data->>'full_name'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 2. CREATE A DEFAULT MARKET
-- If there are no markets, you won't see any tabs. Create at least one:
INSERT INTO public.markets (name) VALUES ('Default Market') ON CONFLICT DO NOTHING;

-- 3. SET YOUR ADMIN STATUS
-- Replace 'user@example.com' with your actual login email.
-- UPDATE public.users SET is_super_admin = true WHERE email = 'user@example.com';

