-- Corrige a macrorregião de dois estados para a divisão oficial do IBGE
-- (autorizado pelo usuário em 13/11/2026):
--   TO estava como Centro-Oeste (110 orelhões) -> Norte
--   RN estava como Norte        (93 orelhões)  -> Nordeste
update public.orelhoes set regiao = 'Norte'    where upper(uf) = 'TO' and regiao <> 'Norte';
update public.orelhoes set regiao = 'Nordeste' where upper(uf) = 'RN' and regiao <> 'Nordeste';

-- conferência: deve voltar TO | Norte | 110 e RN | Nordeste | 93
select uf, regiao, count(*) from public.orelhoes where upper(uf) in ('TO', 'RN') group by 1, 2 order by 1;
