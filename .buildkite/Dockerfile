ARG NODE_VERSION=${NODE_VERSION:-22}
FROM node:$NODE_VERSION

RUN apt-get clean -y && \
  apt-get -qy update && \
  apt-get -y install zip jq && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

