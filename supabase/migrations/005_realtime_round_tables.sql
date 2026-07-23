-- Yazma sırasında bitirme / cevap senkronu için
do $$
begin
  begin
    alter publication supabase_realtime add table public.round_players;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.answers;
  exception when duplicate_object then null;
  end;
end $$;
