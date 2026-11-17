# Quiz Arena — Multiplayer

Jogo web multiplayer de conhecimentos gerais, em português, para 2 a 8 jogadores. As partidas usam salas com código e comunicação em tempo real via Socket.IO.

## Requisitos e execução
- Node.js 18 ou superior.
- Na pasta do projeto, execute `npm install` e depois `npm start`.
- Abra `http://localhost:3000`.
- Para jogar na mesma rede Wi-Fi, os amigos podem acessar o IP local do computador anfitrião, por exemplo `http://192.168.0.10:3000`.

## Configurações da partida
- O anfitrião escolhe **qualquer quantidade inteira de 10 a 50 perguntas** (10, 11, 12... até 50). Menos de 10 não é permitido.
- O tempo por pergunta pode ser 15, 20 ou 25 segundos.
- As categorias ficam **todas misturadas**, sem seleção ou divisão por blocos. História, Geografia, Ciências, Matemática, Língua Portuguesa, Cultura geral e Tecnologia podem surgir em qualquer ordem.
- Uma pergunta não se repete dentro da mesma partida.

## Banco e repetição
- O banco contém exatamente **1.000 perguntas** com quatro alternativas e explicação da resposta.
- O servidor guarda em `question-history.json` os IDs usados recentemente e prioriza perguntas que não apareceram nas partidas recentes. Quando a quantidade solicitada exigir, o sistema relaxa o histórico para completar a partida.
- Isso reduz bastante a repetição entre salas, mas **não garante uma probabilidade fixa de 10%**: a chance real depende do tamanho do banco, do número de partidas e das perguntas disponíveis.
- A seleção é feita pelo servidor quando a partida começa. Se várias instâncias independentes do servidor forem usadas, cada instância terá seu próprio histórico local.

## Pontuação e resumo final
- Acerto vale 100 pontos, com bônus de velocidade de até 50 pontos.
- O placar é atualizado durante a partida.
- No final, o cartão de classificação mostra posição, pontuação, acertos, erros e perguntas não respondidas de cada jogador.

## Jogar pela internet
Para amigos em redes diferentes, publique o projeto em um serviço que aceite Node.js e WebSocket (por exemplo, Render, Railway ou Fly.io). Configure `npm install` como comando de instalação e `npm start` como comando de inicialização. Compartilhe a URL HTTPS publicada.

## Limitações atuais
- Salas e jogadores ficam em memória: reiniciar o servidor encerra as salas ativas.
- Não há contas, histórico persistente de pontuação, nem sistema avançado anti-trapaça.
- O histórico de perguntas é local ao arquivo `question-history.json` do servidor.


## Banco de perguntas (1.000 questões)

O banco contém 1.000 questões de múltipla escolha em sete categorias: História, Geografia, Ciências, Matemática, Língua Portuguesa, Cultura geral e Tecnologia. As perguntas foram redigidas em linguagem própria, com foco nos conhecimentos esperados ao final do 9º ano; as respostas e explicações foram organizadas para uso didático. A seleção é misturada e não repete questões dentro de uma mesma partida. O histórico recente reduz repetições entre salas, mas não garante uma taxa fixa de 10%.

### Referências de consulta para revisão factual e pedagógica
- IBGE Educa — território, biomas e geografia do Brasil: https://educa.ibge.gov.br/jovens/conheca-o-brasil/territorio/
- Atlas Geográfico Escolar do IBGE: https://www.ibge.gov.br/geociencias/atlas/nacional/2402-np-atlas-geografico-escolar/16633-atlas-geografico-escolar.html
- Academia Brasileira de Letras — Vocabulário Ortográfico: https://www.academia.org.br/nossa-lingua/vocabulario-ortografico
- Governo Federal — materiais de cidadania e educação digital: https://www.gov.br/secom/pt-br/assuntos/educacao-midiatica/colecao
- INEP — habilidades avaliadas no Saeb: https://www.gov.br/inep/pt-br/acesso-a-informacao/perguntas-frequentes-1/sistema-de-avaliacao-da-educacao-basica-saeb

As referências orientam os temas e a conferência de conceitos; as questões são formulações originais do Quiz Arena, não cópias integrais de bancos de exercícios.
