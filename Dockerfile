FROM node:4
RUN npm install -g grunt-cli
ADD . /code
WORKDIR /code
RUN npm install
CMD grunt
