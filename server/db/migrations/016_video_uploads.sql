-- Video uploads are part of the Enterprise plan only.
UPDATE subscription_plans SET features = features || jsonb_build_object('videos', name = 'Enterprise');
