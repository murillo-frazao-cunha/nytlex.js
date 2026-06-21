/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 itsmuzin
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export function backendExampleRouteTemplate(typescript: boolean) {
  if (!typescript) {
    return `import {NytlexResponse} from "nytlex"

const ExampleRoute = {
    pattern: '/api/example',
    GET(request, params) {
        return NytlexResponse.json({
            message: 'Welcome to the Example API!'
        })
    },
    POST: async (request, params) => {
        const data = await request.json();
        return NytlexResponse.json({
            message: 'POST request received at Example API!',
            body: data
        })
    }
};

export default ExampleRoute;`;
  }

  return `import {BackendRouteConfig, NytlexRequest, NytlexResponse} from "nytlex"

const ExampleRoute: BackendRouteConfig = {
    pattern: '/api/example',
    GET(request: NytlexRequest, params) {
        return NytlexResponse.json({
            message: 'Welcome to the Example API!'
        })
    },
    POST: async (request: NytlexRequest, params) => {
        const data = await request.json();
        return NytlexResponse.json({
            message: 'POST request received at Example API!',
            body: data
        })
    }
};

export default ExampleRoute;`;
}
