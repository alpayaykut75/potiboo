-- Platform: oda hangi oyuna ait?
alter table public.rooms
  add column if not exists game_type text not null default 'isim_sehir';

alter table public.rooms
  drop constraint if exists rooms_game_type_check;

alter table public.rooms
  add constraint rooms_game_type_check
  check (game_type in (
    'isim_sehir',
    'xox',
    'synked',
    'wordle',
    'amiral',
    'tabu',
    'kizma_birader'
  ));

create index if not exists rooms_game_type_idx on public.rooms (game_type);
