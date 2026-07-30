-- Lobi: oyuncu atma / ayrılma / oda silme

drop policy if exists "room_players_delete_own_or_host" on public.room_players;
create policy "room_players_delete_own_or_host"
  on public.room_players for delete to authenticated
  using (
    profile_id = auth.uid()
    or public.is_room_host(room_id)
  );

drop policy if exists "rooms_delete_host" on public.rooms;
create policy "rooms_delete_host"
  on public.rooms for delete to authenticated
  using (host_id = auth.uid());
